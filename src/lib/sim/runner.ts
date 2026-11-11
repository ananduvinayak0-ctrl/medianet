import type { Campaign, PrismaClient, Workspace } from "@prisma/client";
import { endTestEarly, recordAbDelivery, simAbFor } from "../abtest-service";
import { audit, SYSTEM } from "../audit";
import { getBenchmark } from "../benchmarks";
import { peakForDay } from "../calendar";
import { getAdapter, withRetry } from "../channels/adapter";
import { LEARNING_CONVERSIONS, LEARNING_HOURS, TARGET_ROAS, type PersonaKey } from "../domain";
import { formatDateTime, formatINR, formatPct } from "../format";
import { sumBuckets } from "../metrics";
import { HOUR, istDayKey, istDayStart, MINUTE } from "../time";
import { walletSummary } from "../wallet";
import { simulateDelivery, type BucketDelta, type DayStat } from "./engine";

// Advances the demo clock and lets the mock channel "deliver" live campaigns, then enforces
// hard safety rules (auto-actions) and raises performance alerts (suggestions only).

const SPEED = Number(process.env.SIM_SPEED ?? 120);
const MAX_REAL_DELTA_MS = 60_000; // clock effectively pauses when nobody is watching
const MIN_REAL_DELTA_MS = 1_500;
export const REPORT_LAG_MS = 30 * MINUTE; // channel reports spend ~30 min late

export async function advanceClock(db: PrismaClient, workspaceId: string): Promise<Date> {
  const ws = await db.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
  const realNow = Date.now();
  const realDelta = Math.min(MAX_REAL_DELTA_MS, Math.max(0, realNow - ws.simLastRealTick.getTime()));
  if (realDelta < MIN_REAL_DELTA_MS) return ws.simNow;
  const newSimNow = new Date(ws.simNow.getTime() + realDelta * SPEED);

  // Optimistic claim so concurrent requests never double-deliver.
  const claimed = await db.workspace.updateMany({
    where: { id: ws.id, simLastRealTick: ws.simLastRealTick },
    data: { simLastRealTick: new Date(realNow), simNow: newSimNow },
  });
  if (claimed.count === 0) return (await db.workspace.findUniqueOrThrow({ where: { id: ws.id } })).simNow;

  await runSimulation(db, ws, newSimNow);
  return newSimNow;
}

export async function persistDeltas(db: PrismaClient, campaignId: string, deltas: BucketDelta[]): Promise<void> {
  for (const d of deltas) {
    const inc = {
      impressions: d.impressions,
      clicks: d.clicks,
      conversions: d.conversions,
      returningConversions: d.returningConversions,
      revenuePaise: Math.round(d.revenuePaise),
      spendPaise: Math.round(d.spendPaise),
      treatedConversions: d.treatedConversions,
      holdoutConversions: d.holdoutConversions,
    };
    await db.metricBucket.upsert({
      where: { campaignId_bucketStart: { campaignId, bucketStart: d.bucketStart } },
      create: { campaignId, bucketStart: d.bucketStart, ...inc },
      update: Object.fromEntries(Object.entries(inc).map(([k, v]) => [k, { increment: v }])),
    });
  }
}

export async function runSimulation(db: PrismaClient, ws: Workspace, to: Date): Promise<void> {
  // 1. Scheduled campaigns whose start time has arrived go live.
  const due = await db.campaign.findMany({ where: { workspaceId: ws.id, status: "scheduled", startAt: { lte: to } } });
  for (const c of due) {
    await db.campaign.update({ where: { id: c.id }, data: { status: "live", launchedAt: c.startAt, simulatedUntil: c.startAt } });
    await audit(db, { workspaceId: ws.id, actor: SYSTEM, action: "campaign.started", entityType: "campaign", entityId: c.id, summary: `${c.code} started on schedule`, at: c.startAt });
  }

  // 2. Deliver live campaigns against a shared wallet pool (channel-side cap mirrored from wallet).
  const live = await db.campaign.findMany({ where: { workspaceId: ws.id, status: "live" }, orderBy: { startAt: "asc" } });
  let pool = (await walletSummary(db, ws.id)).availablePaise;
  let walletExhausted = pool <= 0 && live.length > 0;
  const tests = live.length ? await db.abTest.findMany({ where: { campaignId: { in: live.map((c) => c.id) }, status: "running" } }) : [];
  const testByCampaign = new Map(tests.map((t) => [t.campaignId, t]));

  for (const c of live) {
    const from = c.simulatedUntil ?? c.startAt;
    if (from >= to || walletExhausted) continue;
    const dayStats = await loadDayStats(db, c.id, from);
    const test = testByCampaign.get(c.id);
    const res = simulateDelivery(
      {
        id: c.id,
        dailyBudgetPaise: c.dailyBudgetPaise,
        lifetimeBudgetPaise: c.lifetimeBudgetPaise,
        startAt: c.startAt,
        endAt: c.endAt,
        freqCapDay: c.freqCapDay,
        treatedUsers: c.treatedUsers,
        holdoutUsers: c.holdoutUsers,
        bench: getBenchmark(ws.category, c.personaKey as PersonaKey),
        aovPaise: ws.aovPaise,
        totalSpendPaise: c.totalSpendPaise,
        ab: simAbFor(test),
      },
      from,
      to,
      dayStats,
      pool,
    );
    pool -= res.spentPaise;
    await persistDeltas(db, c.id, res.deltas);
    const totalSpendPaise = c.totalSpendPaise + Math.round(res.spentPaise);
    if (test && res.ab) await recordAbDelivery(db, test, res.ab, to, { workspaceId: ws.id, code: c.code });

    if (res.reachedLifetimeCap || res.ended) {
      const reason = res.reachedLifetimeCap ? "Lifetime budget fully spent" : "Reached end date";
      await endTestEarly(db, c.id, "the campaign ended before both variants reached the planned sample.", to, { workspaceId: ws.id, code: c.code });
      await db.campaign.update({ where: { id: c.id }, data: { totalSpendPaise, simulatedUntil: to, status: "completed", statusReason: reason } });
      await createAlert(db, ws.id, c.id, "lifetime_cap", "info", `${c.code} completed: ${reason.toLowerCase()}.`, null, true, to);
      await audit(db, { workspaceId: ws.id, actor: SYSTEM, action: "campaign.completed", entityType: "campaign", entityId: c.id, summary: `${c.code} completed (${reason})`, at: to });
    } else {
      await db.campaign.update({ where: { id: c.id }, data: { totalSpendPaise, simulatedUntil: to } });
    }
    if (res.walletExhausted) walletExhausted = true;
  }

  // 3. Hard safety rule: wallet used up → auto-pause everything still live.
  if (walletExhausted) {
    const still = await db.campaign.findMany({ where: { workspaceId: ws.id, status: "live" } });
    for (const c of still) {
      if (c.externalId) await withRetry(() => getAdapter().pause(c.externalId!)).catch(() => undefined);
      await db.campaign.update({
        where: { id: c.id },
        data: { status: "paused", statusReason: "Auto-paused: wallet balance used up (hard safety rule)" },
      });
      await createAlert(db, ws.id, c.id, "wallet_empty", "critical", `${c.code} was auto-paused because your wallet ran out.`, "Top up your wallet, then resume the campaign. It won't resume automatically.", true, to);
      await audit(db, { workspaceId: ws.id, actor: SYSTEM, action: "campaign.auto_paused", entityType: "campaign", entityId: c.id, summary: `${c.code} auto-paused: wallet exhausted`, at: to });
    }
  }

  // 4. Channel reports spend with a lag → post to the wallet ledger.
  await postReportedSpend(db, ws.id, to);

  // 5. Alerts for campaigns that are still live.
  const nowLive = await db.campaign.findMany({ where: { workspaceId: ws.id, status: "live" } });
  for (const c of nowLive) await evaluateAlerts(db, ws, c, to);
  await evaluateWalletLow(db, ws.id, to);
}

async function loadDayStats(db: PrismaClient, campaignId: string, from: Date): Promise<Record<string, DayStat>> {
  const buckets = await db.metricBucket.findMany({
    where: { campaignId, bucketStart: { gte: istDayStart(from) } },
    select: { bucketStart: true, spendPaise: true, impressions: true },
  });
  const stats: Record<string, DayStat> = {};
  for (const b of buckets) {
    const k = istDayKey(b.bucketStart);
    stats[k] ??= { spendPaise: 0, impressions: 0 };
    stats[k].spendPaise += b.spendPaise;
    stats[k].impressions += b.impressions;
  }
  return stats;
}

export async function postReportedSpend(db: PrismaClient, workspaceId: string, now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - HOUR - REPORT_LAG_MS);
  const ready = await db.metricBucket.findMany({
    where: { spendPosted: false, bucketStart: { lte: cutoff }, campaign: { workspaceId } },
    include: { campaign: { select: { code: true } } },
  });
  if (ready.length === 0) return;
  const entries = ready
    .filter((b) => b.spendPaise > 0)
    .map((b) => ({
      workspaceId,
      campaignId: b.campaignId,
      type: "spend",
      amountPaise: -b.spendPaise,
      memo: `Media.net delivery · ${b.campaign.code} · hour from ${formatDateTime(b.bucketStart)}`,
      createdAt: new Date(b.bucketStart.getTime() + HOUR + REPORT_LAG_MS),
    }));
  if (entries.length) await db.ledgerEntry.createMany({ data: entries });
  await db.metricBucket.updateMany({ where: { id: { in: ready.map((b) => b.id) } }, data: { spendPosted: true } });
}

async function createAlert(
  db: PrismaClient,
  workspaceId: string,
  campaignId: string | null,
  kind: string,
  severity: "info" | "warning" | "critical",
  message: string,
  recommendation: string | null,
  autoActioned: boolean,
  at: Date,
): Promise<void> {
  const open = await db.alert.findFirst({ where: { workspaceId, campaignId, kind, status: "open" } });
  if (open) return;
  await db.alert.create({ data: { workspaceId, campaignId, kind, severity, message, recommendation, autoActioned, createdAt: at } });
}

async function resolveAlert(db: PrismaClient, campaignId: string | null, workspaceId: string, kind: string): Promise<void> {
  await db.alert.updateMany({ where: { workspaceId, campaignId, kind, status: "open" }, data: { status: "resolved" } });
}

/** Performance alerts. These NEVER act on their own; they suggest, and only after the learning period. */
export async function evaluateAlerts(db: PrismaClient, ws: Workspace, c: Campaign, now: Date): Promise<void> {
  const buckets = await db.metricBucket.findMany({ where: { campaignId: c.id }, orderBy: { bucketStart: "asc" } });
  const total = sumBuckets(buckets);
  const liveSince = c.launchedAt ?? c.startAt;
  const liveHours = (now.getTime() - liveSince.getTime()) / HOUR;
  const learning = liveHours < LEARNING_HOURS && total.conversions < LEARNING_CONVERSIONS;

  if (learning) {
    await createAlert(
      db,
      ws.id,
      c.id,
      "learning",
      "info",
      "Learning period: results usually stabilise after 3 days or 30 conversions.",
      "Performance alerts are held back until then. Pausing early often stops campaigns that would have recovered.",
      false,
      now,
    );
    return;
  }
  await resolveAlert(db, c.id, ws.id, "learning");

  const last24 = sumBuckets(buckets.filter((b) => b.bucketStart.getTime() >= now.getTime() - 24 * HOUR));
  const peak = peakForDay(istDayKey(now));
  const targetCpa = (ws.aovPaise / TARGET_ROAS) * (peak ? 1.25 : 1); // looser threshold during peaks

  if (last24.conversions >= 5 && last24.spendPaise / last24.conversions > 1.5 * targetCpa) {
    const cpa = last24.spendPaise / last24.conversions;
    const suggested = Math.round((c.dailyBudgetPaise * 0.75) / 10_000) * 10_000;
    await createAlert(
      db,
      ws.id,
      c.id,
      "cpa_high",
      "warning",
      `Cost per conversion over the last 24h is ${formatINR(cpa)}, more than 1.5× your target of ${formatINR(targetCpa)}.`,
      `Suggestion: lower the daily budget by 25% to ${formatINR(suggested)}, or review the audience. Nothing changes until you act.`,
      false,
      now,
    );
  } else {
    await resolveAlert(db, c.id, ws.id, "cpa_high");
  }

  const first72 = sumBuckets(buckets.filter((b) => b.bucketStart.getTime() < liveSince.getTime() + 72 * HOUR));
  const ctrFirst = first72.impressions > 0 ? first72.clicks / first72.impressions : 0;
  const ctr24 = last24.impressions > 0 ? last24.clicks / last24.impressions : 0;
  if (last24.impressions > 2000 && ctrFirst > 0 && ctr24 < 0.7 * ctrFirst) {
    await createAlert(
      db,
      ws.id,
      c.id,
      "ctr_fatigue",
      "warning",
      `CTR has fallen from ${formatPct(ctrFirst)} in the first 3 days to ${formatPct(ctr24)}. People may be tired of this ad.`,
      `Suggestion: refresh the creative, or lower the frequency cap to ${Math.max(1, c.freqCapDay - 1)}/day.`,
      false,
      now,
    );
  } else {
    await resolveAlert(db, c.id, ws.id, "ctr_fatigue");
  }

  const todayImps = sumBuckets(buckets.filter((b) => istDayKey(b.bucketStart) === istDayKey(now))).impressions;
  if (c.treatedUsers > 0 && todayImps >= 0.95 * c.treatedUsers * c.freqCapDay) {
    await createAlert(db, ws.id, c.id, "freq_saturated", "info", "Everyone in this audience has hit today's frequency cap.", "Delivery resumes at midnight IST. Raising the budget won't help today.", false, now);
  } else {
    await resolveAlert(db, c.id, ws.id, "freq_saturated");
  }
}

async function evaluateWalletLow(db: PrismaClient, workspaceId: string, now: Date): Promise<void> {
  const w = await walletSummary(db, workspaceId);
  if (w.dailyBurnPaise > 0 && w.availablePaise < w.dailyBurnPaise) {
    await createAlert(
      db,
      workspaceId,
      null,
      "wallet_low",
      "warning",
      `Wallet has ${formatINR(Math.max(0, w.availablePaise))} left, less than one day of spend (${formatINR(w.dailyBurnPaise)}/day).`,
      "Top up now. When the wallet runs out, all live campaigns auto-pause.",
      false,
      now,
    );
  } else {
    await resolveAlert(db, null, workspaceId, "wallet_low");
  }
}

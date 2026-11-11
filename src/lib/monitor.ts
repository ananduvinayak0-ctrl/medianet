import type { AbTestView } from "./abtest";
import { toAbView } from "./abtest-service";
import { db } from "./db";
import { LEARNING_CONVERSIONS, LEARNING_HOURS } from "./domain";
import { notFound } from "./errors";
import { derive, liftFor, sumBuckets, type Derived, type Totals } from "./metrics";
import type { Session } from "./session";
import type { LiftResult } from "./stats";
import { HOUR, istDayKey } from "./time";

// Live Monitor payload: shared by the campaign page (initial render) and the polling API.

export interface MonitorData {
  campaign: {
    id: string;
    code: string;
    status: string;
    statusReason: string | null;
    dailyBudgetPaise: number;
    lifetimeBudgetPaise: number;
    totalSpendPaise: number;
    freqCapDay: number;
    treatedUsers: number;
    holdoutUsers: number;
    startAt: string;
    endAt: string;
  };
  simNow: string;
  totals: Totals;
  derived: Derived;
  today: { spendPaise: number; impressions: number; clicks: number; conversions: number; frequency: number };
  reportedSpendPaise: number;
  inFlightSpendPaise: number;
  provisionalConversions: number; // still inside the 7-day attribution window
  hourly: { t: number; spend: number; clicks: number; impressions: number; conversions: number }[];
  lift: LiftResult;
  alerts: { id: string; kind: string; severity: string; message: string; recommendation: string | null; autoActioned: boolean; createdAt: string }[];
  learning: boolean;
  liveHours: number;
  abTest: AbTestView | null;
}

export async function getMonitor(session: Session, id: string): Promise<MonitorData> {
  const c = await db.campaign.findFirst({ where: { id, workspaceId: session.workspace.id } });
  if (!c) throw notFound("Campaign not found");
  const [buckets, alerts, test] = await Promise.all([
    db.metricBucket.findMany({ where: { campaignId: id }, orderBy: { bucketStart: "asc" } }),
    db.alert.findMany({ where: { campaignId: id, status: "open" }, orderBy: { createdAt: "desc" } }),
    db.abTest.findUnique({ where: { campaignId: id } }),
  ]);
  const now = session.simNow;
  const totals = sumBuckets(buckets);
  const todayKey = istDayKey(now);
  const todayT = sumBuckets(buckets.filter((b) => istDayKey(b.bucketStart) === todayKey));
  const since48 = now.getTime() - 48 * HOUR;
  const provisional = sumBuckets(buckets.filter((b) => b.bucketStart.getTime() >= now.getTime() - 7 * 24 * HOUR));
  const reported = buckets.filter((b) => b.spendPosted).reduce((a, b) => a + b.spendPaise, 0);
  const liveSince = c.launchedAt ?? c.startAt;
  const liveHours = c.launchedAt ? Math.max(0, (now.getTime() - liveSince.getTime()) / HOUR) : 0;

  return {
    campaign: {
      id: c.id,
      code: c.code,
      status: c.status,
      statusReason: c.statusReason,
      dailyBudgetPaise: c.dailyBudgetPaise,
      lifetimeBudgetPaise: c.lifetimeBudgetPaise,
      totalSpendPaise: c.totalSpendPaise,
      freqCapDay: c.freqCapDay,
      treatedUsers: c.treatedUsers,
      holdoutUsers: c.holdoutUsers,
      startAt: c.startAt.toISOString(),
      endAt: c.endAt.toISOString(),
    },
    simNow: now.toISOString(),
    totals,
    derived: derive(totals),
    today: {
      spendPaise: todayT.spendPaise,
      impressions: todayT.impressions,
      clicks: todayT.clicks,
      conversions: todayT.conversions,
      frequency: c.treatedUsers > 0 ? todayT.impressions / c.treatedUsers : 0,
    },
    reportedSpendPaise: reported,
    inFlightSpendPaise: totals.spendPaise - reported,
    provisionalConversions: ["live", "paused"].includes(c.status) || now.getTime() - c.endAt.getTime() < 7 * 24 * HOUR ? provisional.conversions : 0,
    hourly: buckets
      .filter((b) => b.bucketStart.getTime() >= since48)
      .map((b) => ({ t: b.bucketStart.getTime(), spend: b.spendPaise / 100, clicks: b.clicks, impressions: b.impressions, conversions: b.conversions })),
    lift: liftFor(totals, c.treatedUsers, c.holdoutUsers),
    alerts: alerts.map((a) => ({ id: a.id, kind: a.kind, severity: a.severity, message: a.message, recommendation: a.recommendation, autoActioned: a.autoActioned, createdAt: a.createdAt.toISOString() })),
    learning: c.status === "live" && liveHours < LEARNING_HOURS && totals.conversions < LEARNING_CONVERSIONS,
    liveHours,
    abTest: test ? toAbView(test, c) : null,
  };
}

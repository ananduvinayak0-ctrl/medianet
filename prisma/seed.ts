/* Seed a realistic demo D2C brand. Run: npm run setup
 * Uses the same simulator as the live app, so history, holdout outcomes and wallet ledger
 * are internally consistent. All shopper data is synthetic. */
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { getBenchmark } from "../src/lib/benchmarks";
import type { PersonaKey } from "../src/lib/domain";
import { refreshControlGroup } from "../src/lib/control-group";
import { deriveCustomerAttributes } from "../src/lib/customer-attributes";
import { createDemoAudiences, DEMO_AUDIENCES } from "../src/lib/demo-audiences";
import { holdoutBucket } from "../src/lib/holdout";
import { allAudienceStats, getPersona, type AudienceStats } from "../src/lib/personas";
import { benchKeyFor, quarterKey } from "../src/lib/segment-defs";
import { segmentFunnel, statsFromFunnel } from "../src/lib/segments";
import { PLAYBOOKS } from "../src/lib/playbooks";
import { seededRng } from "../src/lib/rng";
import { simulateDelivery, type DayStat } from "../src/lib/sim/engine";
import { evaluateAlerts, postReportedSpend } from "../src/lib/sim/runner";
import { getTemplate } from "../src/lib/templates";
import { DAY, HOUR, istDayKey, istDayStart } from "../src/lib/time";

const db = new PrismaClient();
const rng = seededRng("seed-v1");
const PROFILES = 200_000;
const AOV = 89_900; // ₹899

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const daysAgo = (now: Date, d: number) => new Date(now.getTime() - d * DAY);
const at = (dayStart: Date, hour: number) => new Date(dayStart.getTime() + hour * HOUR);

async function main() {
  const now = new Date();
  // The seed wipes every table. Require an explicit opt-in so it never runs against a database by accident.
  if (process.env.ALLOW_DEMO_SEED !== "1") {
    throw new Error("Seed deletes ALL data in DATABASE_URL. Re-run with ALLOW_DEMO_SEED=1 if this is the demo database.");
  }
  console.log("Clearing previous demo data…");
  await db.workspace.deleteMany(); // cascades to all workspace-owned rows
  await db.user.deleteMany();
  await db.idempotencyKey.deleteMany();
  console.log("Seeding demo brand…");

  const ws = await db.workspace.create({
    data: {
      name: "Kaapi & Co.",
      category: "food_beverage",
      holdoutPct: 10,
      holdoutSalt: sha("kaapi-salt").slice(0, 16),
      aovPaise: AOV,
      groupName: "Kaapi Group",
      storeConnectedAt: daysAgo(now, 130),
      pixelInstalledAt: daysAgo(now, 128),
      simNow: now,
      simLastRealTick: now,
    },
  });

  const people = [
    { name: "Aarav Shah", email: "aarav@kaapi.example", role: "owner" },
    { name: "Meera Iyer", email: "meera@kaapi.example", role: "admin" },
    { name: "Rohan Das", email: "rohan@kaapi.example", role: "editor" },
    { name: "Isha Kapoor", email: "isha@kaapi.example", role: "viewer" },
  ];
  const users: Record<string, { id: string; name: string }> = {};
  for (const p of people) {
    const u = await db.user.create({ data: { name: p.name, email: p.email } });
    await db.membership.create({ data: { userId: u.id, workspaceId: ws.id, role: p.role } });
    users[p.role] = u;
  }

  // ---- Shopper profiles (hashed identifiers only) ----
  const rows = [];
  for (let i = 0; i < PROFILES; i++) {
    const r = rng();
    const kind = r < 0.42 ? "browser" : r < 0.57 ? "carter" : "buyer";
    const hasEmail = kind === "buyer" ? true : kind === "carter" ? rng() < 0.7 : rng() < 0.25;
    const idHash = sha(hasEmail ? `shopper${i}@example.com` : `cookie-${i}`);
    const p = {
      workspaceId: ws.id,
      idHash,
      hasEmail,
      matched: hasEmail ? rng() < 0.8 : rng() < 0.5,
      consent: rng() < 0.03 ? "withdrawn" : "granted",
      holdoutBucket: holdoutBucket(idHash, ws.holdoutSalt),
      firstSeenAt: daysAgo(now, 1 + rng() * 400),
      lastViewAt: null as Date | null,
      viewCount14d: 0,
      cartPendingAt: null as Date | null,
      cartValuePaise: 0,
      lastPurchaseAt: null as Date | null,
      purchaseCount: 0,
      totalSpendPaise: 0,
    };
    if (kind === "browser") {
      const d = Math.min(120, -Math.log(1 - rng()) * 20);
      p.lastViewAt = daysAgo(now, d);
      p.viewCount14d = d <= 14 ? Math.floor(rng() * 5) : 0;
    } else if (kind === "carter") {
      const d = rng() * 21;
      p.cartPendingAt = daysAgo(now, d);
      p.lastViewAt = daysAgo(now, Math.max(0, d - rng()));
      p.viewCount14d = d <= 14 ? 1 + Math.floor(rng() * 5) : 0;
      p.cartValuePaise = Math.round(AOV * (0.6 + rng() * 1.4));
    } else {
      const d = Math.pow(rng(), 1.6) * 365;
      p.lastPurchaseAt = daysAgo(now, d);
      p.purchaseCount = 1 + Math.floor(-Math.log(1 - rng()) * 1.8);
      p.totalSpendPaise = Math.round(p.purchaseCount * AOV * (0.7 + rng() * 0.7));
      if (rng() < 0.5) {
        const v = rng() * Math.min(d, 30);
        p.lastViewAt = daysAgo(now, v);
        p.viewCount14d = v <= 14 ? Math.floor(rng() * 4) : 0;
      }
      if (rng() < 0.12 && d > 3) {
        p.cartPendingAt = daysAgo(now, rng() * Math.min(d, 10));
        p.cartValuePaise = Math.round(AOV * (0.6 + rng()));
      }
    }
    rows.push({ ...p, ...deriveCustomerAttributes(p, now, AOV) });
  }
  // 1,500 rows × ~35 columns stays under Postgres's 65,535 bind-parameter limit.
  for (let i = 0; i < rows.length; i += 1500) await db.profile.createMany({ data: rows.slice(i, i + 1500) });
  console.log(`  ${PROFILES.toLocaleString("en-IN")} shopper profiles`);

  // Rule 3: this quarter's stratified control group, then example custom audiences.
  await refreshControlGroup(db, ws, now);
  await db.workspace.update({ where: { id: ws.id }, data: { controlPeriodKey: quarterKey(now), controlRefreshedAt: now } });
  const demoAudiences = await createDemoAudiences(db, ws.id, users.owner.id, daysAgo(now, 70));
  console.log(`  control group for ${quarterKey(now)} + ${Object.keys(demoAudiences).length} custom audiences`);

  // ---- Pixel events (last 30 days). begin_checkout stops firing 2 days ago (theme update broke it). ----
  const pixel = [];
  for (let d = 29; d >= 0; d--) {
    const day = istDayKey(daysAgo(now, d));
    const wave = 1 + 0.15 * Math.sin(d / 3) + (rng() - 0.5) * 0.1;
    const base: Record<string, number> = { page_view: 9200, view_item: 5300, add_to_cart: 920, begin_checkout: 430, purchase: 215 };
    for (const [eventType, n] of Object.entries(base)) {
      const count = eventType === "begin_checkout" && d < 2 ? 0 : Math.round(n * wave);
      pixel.push({ workspaceId: ws.id, day, eventType, count, duplicates: eventType === "purchase" ? Math.round(count * 0.012) : 0, withConsent: Math.round(count * 0.97) });
    }
  }
  await db.pixelEventDaily.createMany({ data: pixel });

  // ---- Wallet top-ups ----
  const topups: [number, number][] = [
    [125, 100_000],
    [70, 150_000],
    [30, 100_000],
    [6, 120_000],
  ];
  for (const [i, [d, r]] of topups.entries()) {
    await db.ledgerEntry.create({
      data: { workspaceId: ws.id, type: "topup", amountPaise: r * 100, memo: "Wallet top-up via Razorpay (mock) · GST invoice issued", invoiceNo: `INV-${daysAgo(now, d).getUTCFullYear()}-${String(i + 1).padStart(5, "0")}`, createdAt: daysAgo(now, d) },
    });
  }

  const stats = await allAudienceStats(db, ws, now);
  let seq = 1001;

  type Plan = { name: string; persona: PersonaKey; audience?: string; startDaysAgo: number; days: number; daily: number; status: string; createdBy?: string; statusReason?: string; offer?: string };
  const customStats: Record<string, AudienceStats> = {};
  for (const a of DEMO_AUDIENCES) customStats[a.key] = statsFromFunnel(await segmentFunnel(db, { ...ws, controlPeriodKey: quarterKey(now) }, a.def, now), a.def);
  const audiencePlan = (key: string) => benchKeyFor(DEMO_AUDIENCES.find((a) => a.key === key)!.def);
  const plans: Plan[] = [
    { name: "Monsoon cart recovery", persona: "cart_abandoners", startDaysAgo: 118, days: 14, daily: 1500, status: "completed" },
    { name: "Win back: summer lapsed", persona: "lapsed_buyers", startDaysAgo: 100, days: 21, daily: 800, status: "completed", offer: "COMEBACK15" },
    { name: "Repeat viewers nudge", persona: "repeat_browsers", startDaysAgo: 84, days: 14, daily: 1200, status: "completed" },
    { name: "Cold brew cross-sell", persona: "recent_buyers", startDaysAgo: 70, days: 14, daily: 900, status: "completed" },
    { name: "Independence Day cart recovery", persona: "cart_abandoners", startDaysAgo: 56, days: 10, daily: 2000, status: "completed" },
    { name: "VIP micro-lot launch", persona: "high_value", startDaysAgo: 45, days: 7, daily: 1100, status: "completed" },
    { name: "Win back: pre-festive", persona: "lapsed_buyers", startDaysAgo: 36, days: 21, daily: 900, status: "stopped", statusReason: "Stopped by Aarav Shah" },
    { name: "Diwali cart recovery", persona: "cart_abandoners", startDaysAgo: 24, days: 18, daily: 3000, status: "completed" },
    // current
    { name: "Post-Diwali cart recovery", persona: "cart_abandoners", startDaysAgo: 5, days: 14, daily: 2500, status: "live" },
    { name: "Win back lapsed buyers: Nov", persona: "lapsed_buyers", startDaysAgo: 1.4, days: 21, daily: 800, status: "live", offer: "COMEBACK15" },
    { name: "Repeat viewers: gifting", persona: "repeat_browsers", startDaysAgo: 3, days: 14, daily: 1000, status: "paused", statusReason: "Paused by Meera Iyer: reviewing creative" },
    // custom audiences
    { name: "Group shoppers: first Kaapi order", persona: audiencePlan("group_potential"), audience: "group_potential", startDaysAgo: 62, days: 14, daily: 1000, status: "completed", offer: "WELCOME10" },
    { name: "Lapsed online regulars: Nov", persona: audiencePlan("lapsed_online"), audience: "lapsed_online", startDaysAgo: 2, days: 21, daily: 900, status: "live", offer: "COMEBACK15" },
  ];

  const playbookFor = (k: PersonaKey) => PLAYBOOKS.find((p) => p.personaKey === k)!;

  for (const plan of plans) {
    const pb = playbookFor(plan.persona);
    const t = getTemplate(pb.templateKey);
    const persona = getPersona(plan.persona);
    const st = plan.audience ? customStats[plan.audience] : stats[plan.persona];
    const jitter = 0.9 + rng() * 0.2;
    const treated = Math.round(st.treated * jitter);
    const holdout = Math.round(st.holdout * jitter);
    const startAt = at(istDayStart(daysAgo(now, plan.startDaysAgo)), 10);
    const endAt = new Date(startAt.getTime() + plan.days * DAY);
    const code = `CMP-${seq++}`;
    const c = await db.campaign.create({
      data: {
        code,
        workspaceId: ws.id,
        name: plan.name,
        description: pb.summary,
        objective: persona.objective,
        status: plan.status,
        statusReason: plan.statusReason ?? (plan.status === "completed" ? "Reached end date" : null),
        externalId: `mn_${code.toLowerCase()}`,
        personaKey: plan.persona,
        customPersonaId: plan.audience ? demoAudiences[plan.audience].id : null,
        templateKey: t.key,
        headline: t.headline,
        body: t.body.replace("{offer}", plan.offer ?? "").replace("{product}", "your pick"),
        cta: t.cta,
        landingUrl: `https://kaapi.example/collections/all?utm_source=medianet&utm_campaign=${code}`,
        offerCode: plan.offer ?? null,
        dailyBudgetPaise: plan.daily * 100,
        lifetimeBudgetPaise: plan.daily * 100 * plan.days,
        freqCapDay: pb.freqCapDay,
        freqCapWeek: pb.freqCapWeek,
        startAt,
        endAt,
        audienceSize: treated + holdout,
        treatedUsers: treated,
        holdoutUsers: holdout,
        launchedAt: startAt,
        createdById: users.owner.id,
        createdAt: daysAgo(startAt, 1),
      },
    });

    const simTo = plan.status === "live" ? now : plan.status === "paused" ? daysAgo(now, 1) : plan.status === "stopped" ? new Date(startAt.getTime() + 9 * DAY) : endAt;
    const dayStats: Record<string, DayStat> = {};
    const res = simulateDelivery(
      { id: c.id, dailyBudgetPaise: c.dailyBudgetPaise, lifetimeBudgetPaise: c.lifetimeBudgetPaise, startAt, endAt, freqCapDay: c.freqCapDay, treatedUsers: treated, holdoutUsers: holdout, bench: getBenchmark(ws.category, plan.persona), aovPaise: AOV, totalSpendPaise: 0 },
      startAt,
      simTo,
      dayStats,
      Number.POSITIVE_INFINITY,
    );
    await db.metricBucket.createMany({
      data: res.deltas.map((d) => ({
        campaignId: c.id,
        bucketStart: d.bucketStart,
        impressions: d.impressions,
        clicks: d.clicks,
        conversions: d.conversions,
        returningConversions: d.returningConversions,
        revenuePaise: Math.round(d.revenuePaise),
        spendPaise: Math.round(d.spendPaise),
        treatedConversions: d.treatedConversions,
        holdoutConversions: d.holdoutConversions,
      })),
    });
    const spent = res.deltas.reduce((a, d) => a + Math.round(d.spendPaise), 0);
    await db.campaign.update({ where: { id: c.id }, data: { totalSpendPaise: spent, simulatedUntil: simTo } });

    // Audit history
    const log = (action: string, summary: string, when: Date, actor: { type: "user" | "system" | "ai"; id?: string; name: string }) =>
      db.auditLog.create({ data: { workspaceId: ws.id, actorUserId: actor.id ?? null, actorName: actor.name, actorType: actor.type, action, entityType: "campaign", entityId: c.id, summary, createdAt: when } });
    const owner = { type: "user" as const, id: users.owner.id, name: users.owner.name };
    await log("campaign.created", `${code} "${plan.name}" created`, daysAgo(startAt, 1), owner);
    const sug = await db.aiSuggestion.create({
      data: { workspaceId: ws.id, campaignId: c.id, type: "budget", inputJson: "{}", outputJson: JSON.stringify({ recommendedDailyPaise: plan.daily * 100 }), status: rng() < 0.7 ? "accepted" : "edited", decidedById: users.owner.id, createdAt: daysAgo(startAt, 1), decidedAt: daysAgo(startAt, 1) },
    });
    await log(`ai_suggestion.${sug.status}`, `Budget suggestion ${sug.status} for ${code} (final ₹${plan.daily.toLocaleString("en-IN")}/day)`, daysAgo(startAt, 1), owner);
    await log("campaign.launched", `${code} launched: ₹${plan.daily.toLocaleString("en-IN")}/day, ${treated.toLocaleString("en-IN")} people (+${holdout.toLocaleString("en-IN")} holdout)`, startAt, owner);
    if (plan.status === "completed") await log("campaign.completed", `${code} completed (Reached end date)`, endAt, { type: "system", name: "System" });
    if (plan.status === "stopped") await log("campaign.stopped", `${code} stopped permanently`, simTo, owner);
    if (plan.status === "paused") await log("campaign.paused", `${code} paused (reviewing creative)`, simTo, { type: "user", id: users.admin.id, name: users.admin.name });

    // Past spend is already reported: post as daily ledger debits.
    if (plan.status !== "live") {
      const byDay = new Map<string, number>();
      for (const d of res.deltas) byDay.set(istDayKey(d.bucketStart), (byDay.get(istDayKey(d.bucketStart)) ?? 0) + Math.round(d.spendPaise));
      await db.ledgerEntry.createMany({
        data: [...byDay.entries()].map(([day, amt]) => ({ workspaceId: ws.id, campaignId: c.id, type: "spend", amountPaise: -amt, memo: `Media.net delivery · ${code} · ${day}`, createdAt: new Date(`${day}T23:59:00+05:30`) })),
      });
      await db.metricBucket.updateMany({ where: { campaignId: c.id }, data: { spendPosted: true } });
    }
  }

  // ---- Upcoming and draft work ----
  const tomorrow = istDayStart(new Date(now.getTime() + DAY));
  const extras = [
    { name: "VIP early access: Black Friday micro-lot", persona: "high_value" as PersonaKey, status: "scheduled", start: at(tomorrow, 10), days: 7, daily: 1100, by: "owner" },
    { name: "Cross-sell pour-over kit", persona: "recent_buyers" as PersonaKey, status: "draft", start: at(tomorrow, 9), days: 14, daily: 900, by: "editor" },
    { name: "Black Friday cart recovery", persona: "cart_abandoners" as PersonaKey, status: "pending_approval", start: at(istDayStart(new Date(now.getTime() + 14 * DAY)), 0), days: 7, daily: 11000, by: "editor" },
  ];
  for (const e of extras) {
    const pb = playbookFor(e.persona);
    const t = getTemplate(pb.templateKey);
    const code = `CMP-${seq++}`;
    const c = await db.campaign.create({
      data: {
        code,
        workspaceId: ws.id,
        name: e.name,
        description: pb.summary,
        objective: getPersona(e.persona).objective,
        status: e.status,
        statusReason: e.status === "pending_approval" ? "Lifetime budget above ₹50,000 needs Owner/Admin approval" : null,
        externalId: e.status === "scheduled" ? `mn_${code.toLowerCase()}` : null,
        personaKey: e.persona,
        templateKey: t.key,
        headline: t.headline,
        body: t.body.replace("{offer}", "").replace("{product}", "your pick"),
        cta: t.cta,
        landingUrl: `https://kaapi.example/collections/all?utm_source=medianet&utm_campaign=${code}`,
        dailyBudgetPaise: e.daily * 100,
        lifetimeBudgetPaise: e.daily * 100 * e.days,
        freqCapDay: pb.freqCapDay,
        freqCapWeek: pb.freqCapWeek,
        startAt: e.start,
        endAt: new Date(e.start.getTime() + e.days * DAY),
        audienceSize: stats[e.persona].eligible,
        treatedUsers: stats[e.persona].treated,
        holdoutUsers: stats[e.persona].holdout,
        simulatedUntil: e.start,
        createdById: users[e.by].id,
        createdAt: daysAgo(now, 0.2),
      },
    });
    await db.auditLog.create({ data: { workspaceId: ws.id, actorUserId: users[e.by].id, actorName: users[e.by].name, actorType: "user", action: e.status === "pending_approval" ? "campaign.approval_requested" : "campaign.created", entityType: "campaign", entityId: c.id, summary: `${code} "${e.name}" ${e.status === "pending_approval" ? "sent for approval" : "created"}`, createdAt: daysAgo(now, 0.2) } });
  }

  await postReportedSpend(db, ws.id, now);
  const fresh = await db.workspace.findUniqueOrThrow({ where: { id: ws.id } });
  for (const c of await db.campaign.findMany({ where: { workspaceId: ws.id, status: "live" } })) await evaluateAlerts(db, fresh, c, now);

  const bal = await db.ledgerEntry.aggregate({ where: { workspaceId: ws.id }, _sum: { amountPaise: true } });
  console.log(`  ${seq - 1001} campaigns, wallet balance ₹${Math.round((bal._sum.amountPaise ?? 0) / 100).toLocaleString("en-IN")}`);
  console.log("Done. Start the app with: npm run dev");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());

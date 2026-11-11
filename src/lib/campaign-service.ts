import type { Campaign } from "@prisma/client";
import { z } from "zod";
import { MDE_OPTIONS, planAbTest, simTrueEffect } from "./abtest";
import { endTestEarly } from "./abtest-service";
import { suggestBudget, type BudgetSuggestion } from "./ai/budget-suggester";
import { AI, audit } from "./audit";
import { getBenchmark } from "./benchmarks";
import { peaksOverlapping } from "./calendar";
import { getAdapter, withRetry } from "./channels/adapter";
import { db } from "./db";
import { MIN_AUDIENCE, OBJECTIVES, PERSONA_KEYS, type PersonaKey } from "./domain";
import { AppError, badRequest, conflict, notFound, unprocessable } from "./errors";
import { formatINR } from "./format";
import { audienceStats, getPersona } from "./personas";
import { checkCreative, withUtm } from "./policy";
import { APPROVAL_THRESHOLD_PAISE, assertCan, can, needsApproval } from "./rbac";
import type { Session } from "./session";
import { TEMPLATES } from "./templates";
import { DAY, daysBetween, istDayKey, istDayStart, MINUTE } from "./time";
import { nextInvoiceNo, walletSummary } from "./wallet";

// All state-changing campaign operations. Route handlers stay thin and call into here.

export const campaignInput = z
  .object({
    name: z.string().trim().min(3, "Name needs at least 3 characters").max(80),
    description: z.string().trim().max(280).default(""),
    objective: z.enum(OBJECTIVES),
    personaKey: z.enum(PERSONA_KEYS),
    templateKey: z.string().min(1),
    headline: z.string().trim(),
    body: z.string().trim(),
    cta: z.string(),
    landingUrl: z.string().trim(),
    offerCode: z
      .string()
      .trim()
      .max(20)
      .regex(/^[A-Z0-9]*$/, "Offer codes use capital letters and numbers only")
      .optional()
      .transform((v) => v || undefined),
    dailyBudgetRupees: z.number().min(500, "Minimum daily budget is ₹500").max(500_000),
    lifetimeBudgetRupees: z.number().min(500).max(10_000_000),
    startAt: z.coerce.date(),
    endAt: z.coerce.date(),
    freqCapDay: z.number().int().min(1).max(10),
    freqCapWeek: z.number().int().min(1).max(50),
    suggestionId: z.string().optional(),
    suggestionDecision: z.enum(["accepted", "edited", "rejected"]).optional(),
    abTest: z
      .object({
        headline: z.string().trim(),
        body: z.string().trim(),
        cta: z.string(),
        mdePct: z.number().int().refine((n) => (MDE_OPTIONS as readonly number[]).includes(n), "Pick one of the offered effect sizes"),
      })
      .nullish(),
  })
  .superRefine((v, ctx) => {
    if (v.lifetimeBudgetRupees < v.dailyBudgetRupees) ctx.addIssue({ code: "custom", path: ["lifetimeBudgetRupees"], message: "Lifetime budget can't be lower than the daily budget" });
    if (v.endAt <= v.startAt) ctx.addIssue({ code: "custom", path: ["endAt"], message: "End must be after start" });
    if (daysBetween(v.startAt, v.endAt) > 90) ctx.addIssue({ code: "custom", path: ["endAt"], message: "Campaigns can run at most 90 days" });
    if (v.freqCapWeek < v.freqCapDay) ctx.addIssue({ code: "custom", path: ["freqCapWeek"], message: "Weekly cap must be at least the daily cap" });
  });

export type CampaignInput = z.infer<typeof campaignInput>;

async function nextCode(): Promise<string> {
  const n = await db.campaign.count();
  return `CMP-${1001 + n}`;
}

export interface AbConfig {
  headline: string;
  body: string;
  cta: string;
  mdePct: number;
}

type LaunchFields = Pick<Campaign, "personaKey" | "headline" | "body" | "cta" | "landingUrl" | "dailyBudgetPaise" | "lifetimeBudgetPaise" | "startAt" | "endAt" | "freqCapDay">;

function abPlanFor(session: Session, c: LaunchFields, ab: AbConfig, treatedUsers: number) {
  const start = c.startAt > session.simNow ? c.startAt : session.simNow;
  return planAbTest({
    bench: getBenchmark(session.workspace.category, c.personaKey as PersonaKey),
    mdePct: ab.mdePct,
    dailyBudgetPaise: c.dailyBudgetPaise,
    lifetimeBudgetPaise: c.lifetimeBudgetPaise,
    durationDays: Math.max(1, Math.round(daysBetween(start, c.endAt))),
    treatedUsers,
    freqCapDay: c.freqCapDay,
  });
}

/** Preconditions for going live. Throws with every blocking reason. */
async function assertLaunchable(session: Session, c: LaunchFields, ab: AbConfig | null) {
  const problems: string[] = [];
  const stats = await audienceStats(db, session.workspace, c.personaKey as PersonaKey, session.simNow);
  if (stats.eligible < MIN_AUDIENCE) problems.push(`Audience has ${stats.eligible} reachable people. The minimum is ${MIN_AUDIENCE}, because smaller audiences can't produce a reliable result.`);
  const policy = checkCreative(c);
  problems.push(...policy.errors);
  if (ab) {
    problems.push(...checkCreative({ ...ab, landingUrl: c.landingUrl }).errors.map((e) => `Variant B: ${e}`));
    if (ab.headline === c.headline && ab.body === c.body && ab.cta === c.cta) problems.push("Variant B is identical to variant A. Change the headline, description or button.");
    problems.push(...abPlanFor(session, c, ab, stats.treated).problems.map((p) => `A/B test: ${p}`));
  }
  const wallet = await walletSummary(db, session.workspace.id);
  if (wallet.availablePaise < c.dailyBudgetPaise) problems.push(`Wallet has ${formatINR(Math.max(0, wallet.availablePaise))} available, less than one day of budget (${formatINR(c.dailyBudgetPaise)}). Top up first.`);
  if (c.endAt <= session.simNow) problems.push("End date is in the past.");
  if (problems.length) throw unprocessable("This campaign can't launch yet", problems);
  return stats;
}

async function goLive(session: Session, c: Campaign, action: string): Promise<Campaign> {
  const test = await db.abTest.findUnique({ where: { campaignId: c.id } });
  const ab = test?.status === "draft" ? { headline: test.bHeadline, body: test.bBody, cta: test.bCta, mdePct: test.mdePct } : null;
  const stats = await assertLaunchable(session, c, ab);
  const startsLater = c.startAt.getTime() > session.simNow.getTime() + MINUTE;
  const { externalId } = await withRetry(() =>
    getAdapter().launch({
      campaignCode: c.code,
      caps: { dailyBudgetPaise: c.dailyBudgetPaise, lifetimeBudgetPaise: c.lifetimeBudgetPaise, freqCapDay: c.freqCapDay, freqCapWeek: c.freqCapWeek },
      audienceSize: stats.treated,
      landingUrl: c.landingUrl,
    }),
  );
  const startAt = startsLater ? c.startAt : session.simNow;
  const updated = await db.campaign.update({
    where: { id: c.id },
    data: {
      status: startsLater ? "scheduled" : "live",
      statusReason: null,
      externalId,
      startAt,
      launchedAt: startsLater ? null : session.simNow,
      simulatedUntil: startAt,
      audienceSize: stats.eligible,
      treatedUsers: stats.treated,
      holdoutUsers: stats.holdout,
      landingUrl: withUtm(c.landingUrl, c.code),
    },
  });
  let abNote = "";
  if (test && ab) {
    const plan = abPlanFor(session, c, ab, stats.treated);
    await db.abTest.update({
      where: { id: test.id },
      data: {
        status: "running",
        aHeadline: c.headline,
        aBody: c.body,
        aCta: c.cta,
        baselineCtr: plan.baselineCtr,
        samplePerVariant: plan.samplePerVariant,
        testBudgetCapPaise: plan.testBudgetCapPaise,
        simTrueEffect: simTrueEffect(test.id),
        startedAt: startAt,
      },
    });
    abNote = `; A/B test needs ${plan.samplePerVariant.toLocaleString("en-IN")} impressions per variant (test budget cap ${formatINR(plan.testBudgetCapPaise)})`;
  }
  await audit(db, {
    workspaceId: session.workspace.id,
    actor: session.actor,
    action,
    entityType: "campaign",
    entityId: c.id,
    summary: `${c.code} ${startsLater ? "scheduled" : "launched"}: ${formatINR(c.dailyBudgetPaise)}/day, cap ${formatINR(c.lifetimeBudgetPaise)}, ${stats.treated} people (+${stats.holdout} holdout)${abNote}`,
    after: { status: updated.status, externalId },
    at: session.simNow,
  });
  return updated;
}

/** Keep a draft's A/B test config in sync with the wizard (create, update or remove). */
async function syncDraftAbTest(campaignId: string, ab: AbConfig | null | undefined): Promise<void> {
  if (!ab) {
    await db.abTest.deleteMany({ where: { campaignId, status: "draft" } });
    return;
  }
  const data = { mdePct: ab.mdePct, bHeadline: ab.headline, bBody: ab.body, bCta: ab.cta };
  await db.abTest.upsert({ where: { campaignId }, create: { campaignId, ...data }, update: data });
}

export async function saveCampaign(session: Session, raw: unknown, opts: { id?: string; launch: boolean }): Promise<Campaign> {
  assertCan(session.role, "campaign:create");
  if (opts.launch) assertCan(session.role, "campaign:launch");
  const parsed = campaignInput.safeParse(raw);
  if (!parsed.success) throw badRequest("Please fix the highlighted fields", parsed.error.flatten());
  const v = parsed.data;
  if (!TEMPLATES.some((t) => t.key === v.templateKey)) throw badRequest("Unknown ad template");
  if (getPersona(v.personaKey).objective !== v.objective) throw badRequest("That audience doesn't match the campaign goal");

  const data = {
    name: v.name,
    description: v.description,
    objective: v.objective,
    personaKey: v.personaKey,
    templateKey: v.templateKey,
    headline: v.headline,
    body: v.body,
    cta: v.cta,
    landingUrl: v.landingUrl,
    offerCode: v.offerCode ?? null,
    dailyBudgetPaise: Math.round(v.dailyBudgetRupees * 100),
    lifetimeBudgetPaise: Math.round(v.lifetimeBudgetRupees * 100),
    startAt: v.startAt,
    endAt: v.endAt,
    freqCapDay: v.freqCapDay,
    freqCapWeek: v.freqCapWeek,
    suggestionId: v.suggestionId ?? null,
  };

  // Validate launch preconditions BEFORE writing, so a failed launch never leaves a stray draft.
  const ab = v.abTest ?? null;
  if (opts.launch) await assertLaunchable(session, data, ab);

  let campaign: Campaign;
  if (opts.id) {
    const existing = await db.campaign.findFirst({ where: { id: opts.id, workspaceId: session.workspace.id } });
    if (!existing) throw notFound("Campaign not found");
    if (existing.status !== "draft") throw conflict("Only drafts can be edited this way. Use budget controls for live campaigns.");
    campaign = await db.campaign.update({ where: { id: existing.id }, data });
    await audit(db, { workspaceId: session.workspace.id, actor: session.actor, action: "campaign.updated", entityType: "campaign", entityId: campaign.id, summary: `${campaign.code} draft updated`, at: session.simNow });
  } else {
    campaign = await db.campaign.create({
      data: { ...data, code: await nextCode(), workspaceId: session.workspace.id, status: "draft", createdById: session.user.id },
    });
    await audit(db, { workspaceId: session.workspace.id, actor: session.actor, action: "campaign.created", entityType: "campaign", entityId: campaign.id, summary: `${campaign.code} "${campaign.name}" created`, at: session.simNow });
  }
  await syncDraftAbTest(campaign.id, ab);

  if (v.suggestionId && v.suggestionDecision) {
    const s = await db.aiSuggestion.findFirst({ where: { id: v.suggestionId, workspaceId: session.workspace.id } });
    if (s && s.status === "shown") {
      await db.aiSuggestion.update({ where: { id: s.id }, data: { status: v.suggestionDecision, campaignId: campaign.id, decidedById: session.user.id, decidedAt: session.simNow } });
      await audit(db, {
        workspaceId: session.workspace.id,
        actor: session.actor,
        action: `ai_suggestion.${v.suggestionDecision}`,
        entityType: "ai_suggestion",
        entityId: s.id,
        summary: `Budget suggestion ${v.suggestionDecision} for ${campaign.code} (final ${formatINR(campaign.dailyBudgetPaise)}/day)`,
        after: { dailyBudgetPaise: campaign.dailyBudgetPaise },
        at: session.simNow,
      });
    }
  }

  if (!opts.launch) return campaign;

  if (needsApproval(session.role, campaign.lifetimeBudgetPaise)) {
    await assertLaunchable(session, campaign, ab);
    const pending = await db.campaign.update({
      where: { id: campaign.id },
      data: { status: "pending_approval", statusReason: `Lifetime budget above ${formatINR(APPROVAL_THRESHOLD_PAISE)} needs Owner/Admin approval` },
    });
    await audit(db, { workspaceId: session.workspace.id, actor: session.actor, action: "campaign.approval_requested", entityType: "campaign", entityId: campaign.id, summary: `${campaign.code} sent for approval (${formatINR(campaign.lifetimeBudgetPaise)} lifetime)`, at: session.simNow });
    return pending;
  }
  return goLive(session, campaign, "campaign.launched");
}

async function load(session: Session, id: string): Promise<Campaign> {
  const c = await db.campaign.findFirst({ where: { id, workspaceId: session.workspace.id } });
  if (!c) throw notFound("Campaign not found");
  return c;
}

export async function launchDraft(session: Session, id: string): Promise<Campaign> {
  assertCan(session.role, "campaign:launch");
  const c = await load(session, id);
  if (c.status !== "draft") throw conflict(`Campaign is ${c.status}, not a draft`);
  if (needsApproval(session.role, c.lifetimeBudgetPaise)) {
    const t = await db.abTest.findUnique({ where: { campaignId: c.id } });
    await assertLaunchable(session, c, t ? { headline: t.bHeadline, body: t.bBody, cta: t.bCta, mdePct: t.mdePct } : null);
    return db.campaign.update({ where: { id }, data: { status: "pending_approval", statusReason: "Needs Owner/Admin approval" } });
  }
  return goLive(session, c, "campaign.launched");
}

export async function approveCampaign(session: Session, id: string): Promise<Campaign> {
  assertCan(session.role, "campaign:approve");
  const c = await load(session, id);
  if (c.status !== "pending_approval") throw conflict("Campaign isn't awaiting approval");
  return goLive(session, c, "campaign.approved_and_launched");
}

export async function pauseCampaign(session: Session, id: string, note?: string): Promise<Campaign> {
  assertCan(session.role, "campaign:pause");
  const c = await load(session, id);
  if (!["live", "scheduled"].includes(c.status)) throw conflict(`Can't pause a ${c.status} campaign`);
  if (c.externalId) await withRetry(() => getAdapter().pause(c.externalId!));
  const updated = await db.campaign.update({ where: { id }, data: { status: "paused", statusReason: `Paused by ${session.user.name}${note ? `: ${note}` : ""}` } });
  await audit(db, { workspaceId: session.workspace.id, actor: session.actor, action: "campaign.paused", entityType: "campaign", entityId: id, summary: `${c.code} paused${note ? ` (${note})` : ""}`, before: { status: c.status }, after: { status: "paused" }, at: session.simNow });
  return updated;
}

export async function resumeCampaign(session: Session, id: string): Promise<Campaign> {
  assertCan(session.role, "campaign:launch");
  const c = await load(session, id);
  if (c.status !== "paused") throw conflict("Only paused campaigns can be resumed");
  if (c.endAt <= session.simNow) throw conflict("End date has passed. Clone the campaign instead.");
  if (c.totalSpendPaise >= c.lifetimeBudgetPaise) throw conflict("Lifetime budget is fully spent. Raise the cap to resume.");
  const wallet = await walletSummary(db, session.workspace.id);
  if (wallet.availablePaise < Math.min(c.dailyBudgetPaise, c.lifetimeBudgetPaise - c.totalSpendPaise))
    throw unprocessable("Not enough wallet balance to resume", [`Available: ${formatINR(Math.max(0, wallet.availablePaise))}. Top up first.`]);
  if (c.externalId) await withRetry(() => getAdapter().resume(c.externalId!));
  const startsLater = c.startAt > session.simNow;
  const updated = await db.campaign.update({
    where: { id },
    data: { status: startsLater ? "scheduled" : "live", statusReason: null, simulatedUntil: startsLater ? c.startAt : session.simNow, launchedAt: c.launchedAt ?? (startsLater ? null : session.simNow) },
  });
  await db.alert.updateMany({ where: { campaignId: id, kind: "wallet_empty", status: "open" }, data: { status: "resolved" } });
  await audit(db, { workspaceId: session.workspace.id, actor: session.actor, action: "campaign.resumed", entityType: "campaign", entityId: id, summary: `${c.code} resumed`, before: { status: "paused" }, after: { status: updated.status }, at: session.simNow });
  return updated;
}

export async function stopCampaign(session: Session, id: string): Promise<Campaign> {
  assertCan(session.role, "campaign:pause");
  const c = await load(session, id);
  if (!["live", "paused", "scheduled", "pending_approval"].includes(c.status)) throw conflict(`Can't stop a ${c.status} campaign`);
  if (c.externalId) await withRetry(() => getAdapter().stop(c.externalId!));
  const updated = await db.campaign.update({ where: { id }, data: { status: "stopped", statusReason: `Stopped by ${session.user.name}` } });
  await audit(db, { workspaceId: session.workspace.id, actor: session.actor, action: "campaign.stopped", entityType: "campaign", entityId: id, summary: `${c.code} stopped permanently`, before: { status: c.status }, after: { status: "stopped" }, at: session.simNow });
  await endTestEarly(db, id, "the campaign was stopped before both variants reached the planned sample.", session.simNow, { workspaceId: session.workspace.id, code: c.code });
  return updated;
}

/** Switch a campaign's creative to variant B after B won its A/B test. Suggest-only: a person must click. */
export async function applyAbWinner(session: Session, id: string): Promise<Campaign> {
  assertCan(session.role, "campaign:launch");
  const c = await load(session, id);
  const t = await db.abTest.findUnique({ where: { campaignId: id } });
  if (!t || t.status !== "complete") throw conflict("This campaign has no finished A/B test");
  if (t.verdict !== "b_wins") throw conflict("Variant B didn't win, so there's nothing to switch to");
  if (t.winnerAppliedAt) throw conflict("Variant B is already in use");
  if (["completed", "stopped"].includes(c.status)) throw conflict(`Can't change the creative of a ${c.status} campaign`);
  const policy = checkCreative({ headline: t.bHeadline, body: t.bBody, cta: t.bCta, landingUrl: c.landingUrl });
  if (!policy.ok) throw unprocessable("Variant B no longer passes the policy check", policy.errors);
  const updated = await db.campaign.update({ where: { id }, data: { headline: t.bHeadline, body: t.bBody, cta: t.bCta } });
  await db.abTest.update({ where: { id: t.id }, data: { winnerAppliedAt: session.simNow } });
  await db.alert.updateMany({ where: { campaignId: id, kind: "ab_test_complete", status: "open" }, data: { status: "actioned" } });
  await audit(db, {
    workspaceId: session.workspace.id,
    actor: session.actor,
    action: "ab_test.winner_applied",
    entityType: "campaign",
    entityId: id,
    summary: `${c.code} switched to A/B winner (variant B): "${t.bHeadline}"`,
    before: { headline: c.headline, body: c.body, cta: c.cta },
    after: { headline: t.bHeadline, body: t.bBody, cta: t.bCta },
    at: session.simNow,
  });
  return updated;
}

export async function cloneCampaign(session: Session, id: string): Promise<Campaign> {
  assertCan(session.role, "campaign:create");
  const c = await load(session, id);
  const duration = c.endAt.getTime() - c.startAt.getTime();
  const startAt = new Date(istDayStart(session.simNow).getTime() + DAY + 9 * 60 * MINUTE); // tomorrow 09:00 IST
  const copy = await db.campaign.create({
    data: {
      code: await nextCode(),
      workspaceId: c.workspaceId,
      name: `${c.name} (copy)`.slice(0, 80),
      description: c.description,
      objective: c.objective,
      status: "draft",
      personaKey: c.personaKey,
      templateKey: c.templateKey,
      headline: c.headline,
      body: c.body,
      cta: c.cta,
      landingUrl: c.landingUrl,
      offerCode: c.offerCode,
      dailyBudgetPaise: c.dailyBudgetPaise,
      lifetimeBudgetPaise: c.lifetimeBudgetPaise,
      freqCapDay: c.freqCapDay,
      freqCapWeek: c.freqCapWeek,
      startAt,
      endAt: new Date(startAt.getTime() + duration),
      createdById: session.user.id,
      clonedFromId: c.id,
    },
  });
  const test = await db.abTest.findUnique({ where: { campaignId: c.id } });
  // Copy the test setup, unless B already won and became the creative (A and B would be identical).
  if (test && !test.winnerAppliedAt) await syncDraftAbTest(copy.id, { headline: test.bHeadline, body: test.bBody, cta: test.bCta, mdePct: test.mdePct });
  await audit(db, { workspaceId: session.workspace.id, actor: session.actor, action: "campaign.cloned", entityType: "campaign", entityId: copy.id, summary: `${copy.code} cloned from ${c.code}`, at: session.simNow });
  return copy;
}

export const budgetChangeInput = z.object({
  dailyBudgetRupees: z.number().min(500).max(500_000),
  lifetimeBudgetRupees: z.number().min(500).max(10_000_000),
  reason: z.string().trim().max(200).optional(),
  alertId: z.string().optional(),
});

export async function changeBudget(session: Session, id: string, raw: unknown): Promise<Campaign> {
  assertCan(session.role, "campaign:edit_daily_budget");
  const parsed = budgetChangeInput.safeParse(raw);
  if (!parsed.success) throw badRequest("Invalid budget", parsed.error.flatten());
  const v = parsed.data;
  const c = await load(session, id);
  if (["completed", "stopped"].includes(c.status)) throw conflict(`Can't change the budget of a ${c.status} campaign`);
  const daily = Math.round(v.dailyBudgetRupees * 100);
  const lifetime = Math.round(v.lifetimeBudgetRupees * 100);
  if (lifetime > c.lifetimeBudgetPaise && !can(session.role, "campaign:raise_lifetime_cap"))
    throw new AppError(403, "Only an Owner or Admin can raise the lifetime spend cap.");
  if (daily > lifetime) throw badRequest("Daily budget can't exceed the lifetime cap");
  if (lifetime < c.totalSpendPaise) throw badRequest(`Lifetime cap can't be below what's already spent (${formatINR(c.totalSpendPaise)})`);
  if (c.externalId) await withRetry(() => getAdapter().setCaps(c.externalId!, { dailyBudgetPaise: daily, lifetimeBudgetPaise: lifetime, freqCapDay: c.freqCapDay, freqCapWeek: c.freqCapWeek }));
  const updated = await db.campaign.update({ where: { id }, data: { dailyBudgetPaise: daily, lifetimeBudgetPaise: lifetime } });
  if (v.alertId) await db.alert.updateMany({ where: { id: v.alertId, campaignId: id }, data: { status: "actioned" } });
  await audit(db, {
    workspaceId: session.workspace.id,
    actor: session.actor,
    action: "campaign.budget_changed",
    entityType: "campaign",
    entityId: id,
    summary: `${c.code} budget ${formatINR(c.dailyBudgetPaise)}→${formatINR(daily)}/day, cap ${formatINR(c.lifetimeBudgetPaise)}→${formatINR(lifetime)}${v.reason ? ` (${v.reason})` : ""}`,
    before: { dailyBudgetPaise: c.dailyBudgetPaise, lifetimeBudgetPaise: c.lifetimeBudgetPaise },
    after: { dailyBudgetPaise: daily, lifetimeBudgetPaise: lifetime },
    at: session.simNow,
  });
  return updated;
}

export async function updateAlert(session: Session, alertId: string, status: "dismissed" | "actioned"): Promise<void> {
  if (session.role === "viewer") throw new AppError(403, "Viewers can't change alerts");
  const a = await db.alert.findFirst({ where: { id: alertId, workspaceId: session.workspace.id } });
  if (!a) throw notFound("Alert not found");
  await db.alert.update({ where: { id: alertId }, data: { status } });
  await audit(db, { workspaceId: session.workspace.id, actor: session.actor, action: `alert.${status}`, entityType: "alert", entityId: alertId, summary: `Alert "${a.kind}" ${status}`, at: session.simNow });
}

export async function topUpWallet(session: Session, rupees: number): Promise<{ invoiceNo: string }> {
  assertCan(session.role, "wallet:topup");
  if (!Number.isFinite(rupees) || rupees < 500 || rupees > 1_000_000) throw badRequest("Top-up must be between ₹500 and ₹10,00,000");
  const invoiceNo = await nextInvoiceNo(db, session.workspace.id, session.simNow);
  const paise = Math.round(rupees * 100);
  await db.ledgerEntry.create({
    data: { workspaceId: session.workspace.id, type: "topup", amountPaise: paise, memo: "Wallet top-up via Razorpay (mock) · GST invoice issued", invoiceNo, createdAt: session.simNow },
  });
  await audit(db, { workspaceId: session.workspace.id, actor: session.actor, action: "wallet.topup", entityType: "wallet", entityId: session.workspace.id, summary: `Wallet topped up by ${formatINR(paise)} (${invoiceNo})`, at: session.simNow });
  return { invoiceNo };
}

// ---------- Budget Suggester ----------

export const suggestionInput = z.object({
  personaKey: z.enum(PERSONA_KEYS),
  startAt: z.coerce.date(),
  endAt: z.coerce.date(),
  freqCapDay: z.number().int().min(1).max(10),
});

export async function createBudgetSuggestion(session: Session, raw: unknown): Promise<{ id: string; suggestion: BudgetSuggestion }> {
  const parsed = suggestionInput.safeParse(raw);
  if (!parsed.success) throw badRequest("Invalid suggestion request", parsed.error.flatten());
  const v = parsed.data;
  const ws = session.workspace;
  const persona = getPersona(v.personaKey);
  const stats = await audienceStats(db, ws, v.personaKey, session.simNow);
  const wallet = await walletSummary(db, ws.id);

  const done = await db.campaign.findMany({ where: { workspaceId: ws.id, status: { in: ["completed", "stopped"] } }, select: { id: true, personaKey: true, startAt: true, endAt: true } });
  const sums = await db.metricBucket.groupBy({
    by: ["campaignId"],
    where: { campaignId: { in: done.map((d) => d.id) } },
    _sum: { spendPaise: true, clicks: true, conversions: true, revenuePaise: true },
    _min: { bucketStart: true },
    _max: { bucketStart: true },
  });
  const history = sums.map((s) => {
    const c = done.find((d) => d.id === s.campaignId)!;
    const days = Math.max(1, daysBetween(s._min.bucketStart ?? c.startAt, s._max.bucketStart ?? c.endAt));
    return { personaKey: c.personaKey, days, spendPaise: s._sum.spendPaise ?? 0, clicks: s._sum.clicks ?? 0, conversions: s._sum.conversions ?? 0, revenuePaise: s._sum.revenuePaise ?? 0 };
  });

  const peak = peaksOverlapping(istDayKey(v.startAt), istDayKey(v.endAt))[0] ?? null;
  const input = {
    personaKey: v.personaKey,
    personaName: persona.name,
    bench: getBenchmark(ws.category, v.personaKey),
    treatedUsers: stats.treated,
    freqCapDay: v.freqCapDay,
    durationDays: daysBetween(v.startAt, v.endAt),
    aovPaise: ws.aovPaise,
    walletAvailablePaise: Math.max(0, wallet.availablePaise - wallet.committedPaise),
    history,
    peak,
  };
  const suggestion = suggestBudget(input);
  const row = await db.aiSuggestion.create({
    data: { workspaceId: ws.id, type: "budget", inputJson: JSON.stringify(input), outputJson: JSON.stringify(suggestion), createdAt: session.simNow },
  });
  await audit(db, {
    workspaceId: ws.id,
    actor: AI,
    action: "ai_suggestion.shown",
    entityType: "ai_suggestion",
    entityId: row.id,
    summary:
      suggestion.status === "ok"
        ? `Suggested ${formatINR(suggestion.recommendedDailyPaise)}/day for "${persona.name}" (${suggestion.confidence} confidence)`
        : `Withheld budget suggestion for "${persona.name}": not enough data`,
    at: session.simNow,
  });
  return { id: row.id, suggestion };
}

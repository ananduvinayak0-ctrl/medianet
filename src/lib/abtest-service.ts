import type { AbTest, PrismaClient } from "@prisma/client";
import { decideTest, VERDICT_LABEL, type AbComparison, type AbTestView, type AbVerdict } from "./abtest";
import { audit, SYSTEM } from "./audit";
import type { AbDelta, SimAbTest } from "./sim/engine";

// A/B test lifecycle on the server: feeding the simulator, recording delivery, and closing tests.

type Db = PrismaClient;

export function simAbFor(t: AbTest | undefined): SimAbTest | undefined {
  if (!t || t.status !== "running") return undefined;
  return {
    ctrMultiplierB: 1 + t.simTrueEffect,
    needA: Math.max(0, t.samplePerVariant - t.impressionsA),
    needB: Math.max(0, t.samplePerVariant - t.impressionsB),
    budgetLeftPaise: Math.max(0, t.testBudgetCapPaise - t.spendPaise),
  };
}

const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;

function verdictSummary(verdict: AbVerdict, cmp: AbComparison | null, reason: string | null): string {
  if (!cmp) return `Inconclusive: ${reason}`;
  if (verdict === "inconclusive") return `Inconclusive: B's CTR was ${pct(cmp.relLift)} vs A, within the range of random noise (p = ${cmp.pValue.toFixed(2)}).`;
  return `${VERDICT_LABEL[verdict]}: B's CTR was ${pct(cmp.relLift)} vs A (95% range ${pct(cmp.ciLow)} to ${pct(cmp.ciHigh)}, p = ${cmp.pValue.toFixed(3)}).`;
}

async function closeTest(db: Db, t: AbTest, verdict: AbVerdict, cmp: AbComparison | null, reason: string | null, at: Date, ctx: { workspaceId: string; code: string }) {
  await db.abTest.update({
    where: { id: t.id },
    data: {
      status: "complete",
      verdict,
      verdictReason: reason,
      completedAt: at,
      pValue: cmp?.pValue ?? null,
      relLift: cmp?.relLift ?? null,
      ciLow: cmp?.ciLow ?? null,
      ciHigh: cmp?.ciHigh ?? null,
    },
  });
  const summary = verdictSummary(verdict, cmp, reason);
  await db.alert.create({
    data: {
      workspaceId: ctx.workspaceId,
      campaignId: t.campaignId,
      kind: "ab_test_complete",
      severity: "info",
      message: `A/B test on ${ctx.code} finished. ${summary}`,
      recommendation:
        verdict === "b_wins"
          ? "You can switch the campaign to variant B from the A/B test card. Nothing changes until you do."
          : verdict === "a_wins"
            ? "Keep variant A. The campaign already runs it."
            : "Keep variant A, or test a bolder change next time. Small copy tweaks rarely move CTR enough to measure.",
      autoActioned: false,
      createdAt: at,
    },
  });
  await audit(db, { workspaceId: ctx.workspaceId, actor: SYSTEM, action: "ab_test.completed", entityType: "campaign", entityId: t.campaignId, summary: `${ctx.code} A/B test: ${summary}`, at });
}

/** Add one simulation tick's split delivery to the test, and close it at the planned sample. */
export async function recordAbDelivery(db: Db, t: AbTest, d: AbDelta, at: Date, ctx: { workspaceId: string; code: string }): Promise<void> {
  const updated = await db.abTest.update({
    where: { id: t.id },
    data: {
      impressionsA: { increment: d.impressionsA },
      clicksA: { increment: d.clicksA },
      impressionsB: { increment: d.impressionsB },
      clicksB: { increment: d.clicksB },
      spendPaise: { increment: d.spendPaise },
    },
  });
  const decision = decideTest(updated);
  if (decision) return closeTest(db, updated, decision.verdict, decision.comparison, null, at, ctx);
  if (updated.spendPaise >= updated.testBudgetCapPaise - 0.5)
    return closeTest(db, updated, "inconclusive", null, "the test budget (20% of the campaign budget) ran out before both variants reached the planned sample.", at, ctx);
}

/** UI-safe view of a test. Click data is withheld until the test is complete (no peeking). */
export function toAbView(t: AbTest, campaign: { headline: string; body: string; cta: string }): AbTestView {
  const done = t.status === "complete";
  return {
    status: t.status as AbTestView["status"],
    mdePct: t.mdePct,
    samplePerVariant: t.samplePerVariant,
    testBudgetCapPaise: t.testBudgetCapPaise,
    spendPaise: t.spendPaise,
    impressionsA: t.impressionsA,
    impressionsB: t.impressionsB,
    // Before launch, A is whatever the campaign currently runs; afterwards, the launch snapshot.
    variantA: t.status === "draft" ? campaign : { headline: t.aHeadline, body: t.aBody, cta: t.aCta },
    variantB: { headline: t.bHeadline, body: t.bBody, cta: t.bCta },
    result: done
      ? {
          verdict: (t.verdict ?? "inconclusive") as AbVerdict,
          reason: t.verdictReason,
          clicksA: t.clicksA,
          clicksB: t.clicksB,
          ctrA: t.impressionsA > 0 ? t.clicksA / t.impressionsA : 0,
          ctrB: t.impressionsB > 0 ? t.clicksB / t.impressionsB : 0,
          relLift: t.relLift,
          ciLow: t.ciLow,
          ciHigh: t.ciHigh,
          pValue: t.pValue,
          completedAt: t.completedAt?.toISOString() ?? null,
          winnerApplied: Boolean(t.winnerAppliedAt),
        }
      : null,
  };
}

/** Close a running test without a verdict, e.g. when the campaign ends or is stopped first. */
export async function endTestEarly(db: Db, campaignId: string, reason: string, at: Date, ctx: { workspaceId: string; code: string }): Promise<void> {
  const t = await db.abTest.findUnique({ where: { campaignId } });
  if (!t || t.status !== "running") return;
  await closeTest(db, t, "inconclusive", null, reason, at, ctx);
}

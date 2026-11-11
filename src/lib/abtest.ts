import type { Benchmark } from "./benchmarks";
import { formatINR, formatNum } from "./format";
import { seededRng } from "./rng";

// A/B testing (T-19, decision Q17). Creative tests only: variant A is the campaign's creative,
// variant B changes the copy. The metric is CTR (clicks ÷ impressions), because that's what a
// creative change moves first and it's reachable on SMB budgets; purchase-rate tests need ~10×
// more traffic.
//
// Fixed-horizon design: the sample size is decided before launch (80% power, 5% two-sided
// significance, the brand's minimum detectable effect). Interim results are never shown and a
// verdict is only computed once BOTH variants reach the planned sample. Peeking and stopping on
// the first "significant" blip inflates false winners from 5% to 20–30%.

export const AB_ALPHA = 0.05;
export const AB_POWER = 0.8;
const Z_ALPHA = 1.959964; // two-sided 5%
const Z_BETA = 0.841621; // 80% power

/** Minimum detectable effect choices, as relative CTR change (%). */
export const MDE_OPTIONS = [10, 15, 20, 30] as const;
export type MdePct = (typeof MDE_OPTIONS)[number];
export const DEFAULT_MDE: MdePct = 20;

/** The test may use at most this share of the campaign's lifetime budget. */
export const AB_MAX_BUDGET_SHARE = 0.2;

export type AbVerdict = "a_wins" | "b_wins" | "inconclusive";

export const VERDICT_LABEL: Record<AbVerdict, string> = {
  a_wins: "A wins",
  b_wins: "B wins",
  inconclusive: "Inconclusive",
};

/**
 * Impressions needed PER VARIANT to detect a relative change of `mdeRel` from `baseline`
 * (two-proportion z-test, normal approximation).
 */
export function sampleSizePerVariant(baseline: number, mdeRel: number, alphaZ = Z_ALPHA, powerZ = Z_BETA): number {
  if (!(baseline > 0 && baseline < 1) || !(mdeRel > 0)) throw new Error("baseline must be in (0,1) and mdeRel > 0");
  const p1 = baseline;
  const p2 = Math.min(0.999, baseline * (1 + mdeRel));
  const pBar = (p1 + p2) / 2;
  const num = alphaZ * Math.sqrt(2 * pBar * (1 - pBar)) + powerZ * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2));
  return Math.ceil((num * num) / ((p2 - p1) * (p2 - p1)));
}

export interface AbPlanInput {
  bench: Pick<Benchmark, "ctr" | "cpcPaise">;
  mdePct: number;
  dailyBudgetPaise: number;
  lifetimeBudgetPaise: number;
  durationDays: number;
  treatedUsers: number;
  freqCapDay: number;
}

export interface AbPlan {
  baselineCtr: number;
  mdePct: number;
  samplePerVariant: number;
  totalImpressions: number;
  estCostPaise: number;
  testBudgetCapPaise: number;
  estDays: number;
  /** Reasons the test can't run as planned. Empty = feasible. */
  problems: string[];
}

/** Pre-launch plan: sample size, expected cost and duration, and whether it fits the rules. */
export function planAbTest(i: AbPlanInput): AbPlan {
  const baselineCtr = i.bench.ctr;
  const samplePerVariant = sampleSizePerVariant(baselineCtr, i.mdePct / 100);
  const totalImpressions = samplePerVariant * 2;
  const costPerImpression = i.bench.cpcPaise * baselineCtr; // CPC-billed: cost per click × clicks per impression
  const estCostPaise = Math.round(totalImpressions * costPerImpression);
  const testBudgetCapPaise = Math.floor(i.lifetimeBudgetPaise * AB_MAX_BUDGET_SHARE);
  const dailyImpressions = Math.min(i.dailyBudgetPaise / costPerImpression, Math.max(0, i.treatedUsers * i.freqCapDay));
  const estDays = dailyImpressions > 0 ? Math.ceil(totalImpressions / dailyImpressions) : Infinity;

  const problems: string[] = [];
  if (estCostPaise > testBudgetCapPaise)
    problems.push(
      `The test needs about ${formatINR(estCostPaise)} of delivery to reach ${formatNum(samplePerVariant)} impressions per variant. That's more than ${AB_MAX_BUDGET_SHARE * 100}% of the campaign budget (${formatINR(testBudgetCapPaise)}). Raise the budget, or look for a bigger difference.`,
    );
  if (estDays > i.durationDays)
    problems.push(
      `Reaching the planned sample takes about ${Number.isFinite(estDays) ? estDays : "∞"} days, but the campaign runs ${i.durationDays}. Run longer, raise the daily budget, or look for a bigger difference.`,
    );
  return { baselineCtr, mdePct: i.mdePct, samplePerVariant, totalImpressions, estCostPaise, testBudgetCapPaise, estDays, problems };
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26, |error| < 1.5e-7). */
export function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

export interface AbComparison {
  ctrA: number;
  ctrB: number;
  relLift: number; // (B − A) / A
  ciLow: number; // 95% CI on relative lift
  ciHigh: number;
  pValue: number;
  winner: "a" | "b" | null;
}

/** Two-proportion z-test on CTR. */
export function compareVariants(clicksA: number, impsA: number, clicksB: number, impsB: number): AbComparison {
  const pA = impsA > 0 ? clicksA / impsA : 0;
  const pB = impsB > 0 ? clicksB / impsB : 0;
  const pooled = impsA + impsB > 0 ? (clicksA + clicksB) / (impsA + impsB) : 0;
  const sePooled = Math.sqrt(pooled * (1 - pooled) * (1 / Math.max(1, impsA) + 1 / Math.max(1, impsB)));
  const z = sePooled > 0 ? (pB - pA) / sePooled : 0;
  const pValue = 2 * (1 - normalCdf(Math.abs(z)));
  const se = Math.sqrt((pA * (1 - pA)) / Math.max(1, impsA) + (pB * (1 - pB)) / Math.max(1, impsB));
  const diff = pB - pA;
  return {
    ctrA: pA,
    ctrB: pB,
    relLift: pA > 0 ? diff / pA : 0,
    ciLow: pA > 0 ? (diff - Z_ALPHA * se) / pA : 0,
    ciHigh: pA > 0 ? (diff + Z_ALPHA * se) / pA : 0,
    pValue,
    winner: pValue < AB_ALPHA ? (pB > pA ? "b" : "a") : null,
  };
}

export interface AbCounters {
  impressionsA: number;
  clicksA: number;
  impressionsB: number;
  clicksB: number;
  samplePerVariant: number;
}

/** True once both variants have reached the sample size fixed before launch. */
export function reachedPlannedSample(t: Pick<AbCounters, "impressionsA" | "impressionsB" | "samplePerVariant">): boolean {
  return t.samplePerVariant > 0 && t.impressionsA >= t.samplePerVariant && t.impressionsB >= t.samplePerVariant;
}

/**
 * The fixed-horizon decision. Returns null until the planned sample is reached, so no code
 * path can declare a winner early.
 */
export function decideTest(t: AbCounters): { verdict: AbVerdict; comparison: AbComparison } | null {
  if (!reachedPlannedSample(t)) return null;
  const comparison = compareVariants(t.clicksA, t.impressionsA, t.clicksB, t.impressionsB);
  const verdict: AbVerdict = comparison.winner === "b" ? "b_wins" : comparison.winner === "a" ? "a_wins" : "inconclusive";
  return { verdict, comparison };
}

/**
 * What the UI may see about a test. While it's running, only progress is exposed. Interim
 * click counts and CTRs never leave the server, so the "no peeking" rule can't be bypassed.
 */
export interface AbTestView {
  status: "draft" | "running" | "complete";
  mdePct: number;
  samplePerVariant: number;
  testBudgetCapPaise: number;
  spendPaise: number;
  impressionsA: number;
  impressionsB: number;
  variantA: { headline: string; body: string; cta: string };
  variantB: { headline: string; body: string; cta: string };
  result: null | {
    verdict: AbVerdict;
    reason: string | null;
    clicksA: number;
    clicksB: number;
    ctrA: number;
    ctrB: number;
    relLift: number | null;
    ciLow: number | null;
    ciHigh: number | null;
    pValue: number | null;
    completedAt: string | null;
    winnerApplied: boolean;
  };
}

/**
 * Mock channel only: the hidden "true" CTR effect of variant B, deterministic per test.
 * About a third of challengers make no real difference, which is what real creative tests
 * look like, so "inconclusive" shows up as often as it should.
 */
export function simTrueEffect(seed: string): number {
  const r = seededRng(seed, "ab-truth");
  const kind = r();
  const size = r();
  const sign = r();
  if (kind < 0.35) return (size - 0.5) * 0.08; // within ±4%: effectively no difference
  const magnitude = 0.12 + size * 0.23; // 12–35%
  return sign < 0.6 ? magnitude : -magnitude;
}

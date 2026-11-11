// Measurement maths: incremental lift vs holdout, and the North Star Metric.

export const MIN_CONVERSIONS_FOR_LIFT = 20;

export interface LiftResult {
  status: "ok" | "insufficient_data";
  treatedRate: number;
  holdoutRate: number;
  relativeLift: number; // (treated - holdout) / holdout
  ciLow: number; // 95% CI on relative lift
  ciHigh: number;
  significant: boolean; // CI excludes zero
  incrementalConversions: number;
}

/**
 * Two-proportion comparison (normal approximation). Rates are conversions per user over the
 * same window. The CI on relative lift is the CI of the absolute difference scaled by the
 * holdout rate — a deliberately simple, explainable approximation for MVP.
 */
export function computeLift(treatedConv: number, treatedN: number, holdoutConv: number, holdoutN: number): LiftResult {
  const p1 = treatedN > 0 ? treatedConv / treatedN : 0;
  const p2 = holdoutN > 0 ? holdoutConv / holdoutN : 0;
  const enough = treatedConv >= MIN_CONVERSIONS_FOR_LIFT && holdoutConv >= MIN_CONVERSIONS_FOR_LIFT && p2 > 0;
  const se = Math.sqrt((p1 * (1 - p1)) / Math.max(1, treatedN) + (p2 * (1 - p2)) / Math.max(1, holdoutN));
  const diff = p1 - p2;
  const rel = p2 > 0 ? diff / p2 : 0;
  const ciLow = p2 > 0 ? (diff - 1.96 * se) / p2 : 0;
  const ciHigh = p2 > 0 ? (diff + 1.96 * se) / p2 : 0;
  return {
    status: enough ? "ok" : "insufficient_data",
    treatedRate: p1,
    holdoutRate: p2,
    relativeLift: rel,
    ciLow,
    ciHigh,
    significant: enough && ciLow > 0,
    incrementalConversions: Math.max(0, diff * treatedN),
  };
}

/** Share of clicks that are unique clickers (dedupe repeat clicks by the same shopper). */
export const UNIQUE_CLICKER_RATIO = 0.85;

/**
 * North Star Metric:
 *   NSM = returning customers who engaged (clicked) and converted × 100 ÷ customers who engaged
 * Reported alongside incremental lift so the number can't look good by retargeting people who
 * would have bought anyway.
 */
export function computeNsm(clicks: number, returningConversions: number): number {
  const engaged = clicks * UNIQUE_CLICKER_RATIO;
  return engaged > 0 ? (returningConversions * 100) / engaged : 0;
}

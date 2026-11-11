import { describe, expect, it } from "vitest";
import { AB_MAX_BUDGET_SHARE, compareVariants, decideTest, normalCdf, planAbTest, sampleSizePerVariant, simTrueEffect } from "../abtest";
import { getBenchmark } from "../benchmarks";
import { seededRng } from "../rng";
import { simulateDelivery, type DayStat } from "../sim/engine";
import { DAY } from "../time";

/** Binomial draw via normal approximation (fine for the large n used here). */
function draw(n: number, p: number, rng: () => number): number {
  const z = Math.sqrt(-2 * Math.log(Math.max(1e-12, rng()))) * Math.cos(2 * Math.PI * rng());
  return Math.max(0, Math.round(n * p + z * Math.sqrt(n * p * (1 - p))));
}

describe("A/B power calculation", () => {
  it("matches the textbook sample size (10% → 12%, 80% power, 5% two-sided)", () => {
    expect(sampleSizePerVariant(0.1, 0.2)).toBe(3841);
  });
  it("needs more traffic for smaller effects and rarer clicks", () => {
    expect(sampleSizePerVariant(0.012, 0.1)).toBeGreaterThan(sampleSizePerVariant(0.012, 0.2));
    expect(sampleSizePerVariant(0.006, 0.2)).toBeGreaterThan(sampleSizePerVariant(0.012, 0.2));
  });
  it("rejects nonsense inputs", () => {
    expect(() => sampleSizePerVariant(0, 0.2)).toThrow();
    expect(() => sampleSizePerVariant(0.01, 0)).toThrow();
  });
  it("has an accurate normal CDF", () => {
    expect(normalCdf(1.959964)).toBeCloseTo(0.975, 4);
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(-1.644854)).toBeCloseTo(0.05, 4);
  });
});

describe("A/B plan", () => {
  const bench = getBenchmark("food_beverage", "cart_abandoners");
  // ₹3,000/day × 14 days: a 20% CTR test on cart abandoners costs ~₹7.7k, under the ₹8.4k cap.
  const base = { bench, mdePct: 20, dailyBudgetPaise: 300_000, lifetimeBudgetPaise: 4_200_000, durationDays: 14, treatedUsers: 8000, freqCapDay: 3 };

  it("is feasible when the test fits in 20% of the budget and the run time", () => {
    const p = planAbTest(base);
    expect(p.testBudgetCapPaise).toBe(4_200_000 * AB_MAX_BUDGET_SHARE);
    expect(p.estCostPaise).toBeLessThanOrEqual(p.testBudgetCapPaise);
    expect(p.problems).toEqual([]);
  });
  it("blocks a test that would eat more than 20% of the budget", () => {
    const p = planAbTest({ ...base, mdePct: 10 });
    expect(p.estCostPaise).toBeGreaterThan(p.testBudgetCapPaise);
    expect(p.problems.some((x) => x.includes("20%"))).toBe(true);
  });
  it("blocks a test that can't finish before the campaign ends", () => {
    const p = planAbTest({ ...base, durationDays: 1, lifetimeBudgetPaise: 100_000_000 });
    expect(p.problems.some((x) => x.includes("days"))).toBe(true);
  });
});

describe("A/B decision (fixed horizon)", () => {
  it("never declares a winner before the planned sample, however lopsided the data", () => {
    expect(decideTest({ impressionsA: 9_999, clicksA: 10, impressionsB: 9_999, clicksB: 500, samplePerVariant: 10_000 })).toBeNull();
    expect(decideTest({ impressionsA: 20_000, clicksA: 10, impressionsB: 9_999, clicksB: 500, samplePerVariant: 10_000 })).toBeNull();
  });
  it("declares B the winner at the planned sample when the gap is real", () => {
    const d = decideTest({ impressionsA: 20_000, clicksA: 240, impressionsB: 20_000, clicksB: 320, samplePerVariant: 20_000 });
    expect(d?.verdict).toBe("b_wins");
    expect(d!.comparison.pValue).toBeLessThan(0.05);
    expect(d!.comparison.ciLow).toBeGreaterThan(0);
  });
  it("calls it inconclusive when the gap is within noise", () => {
    const d = decideTest({ impressionsA: 20_000, clicksA: 240, impressionsB: 20_000, clicksB: 250, samplePerVariant: 20_000 });
    expect(d?.verdict).toBe("inconclusive");
    expect(d!.comparison.ciLow).toBeLessThan(0);
    expect(d!.comparison.ciHigh).toBeGreaterThan(0);
  });
  it("can declare A the winner", () => {
    expect(decideTest({ impressionsA: 20_000, clicksA: 320, impressionsB: 20_000, clicksB: 240, samplePerVariant: 20_000 })?.verdict).toBe("a_wins");
  });

  it("keeps false winners near 5% in A/A tests, and peeking would inflate them", () => {
    const rng = seededRng("aa-tests");
    const n = sampleSizePerVariant(0.012, 0.2);
    const p = 0.012;
    let fixedHorizonWins = 0;
    let peekingWins = 0;
    const runs = 2000;
    for (let i = 0; i < runs; i++) {
      // 10 equal looks; the "peeker" stops at the first p < 0.05.
      let cA = 0;
      let cB = 0;
      let peeked = false;
      for (let look = 1; look <= 10; look++) {
        cA += draw(n / 10, p, rng);
        cB += draw(n / 10, p, rng);
        if (!peeked && compareVariants(cA, (n * look) / 10, cB, (n * look) / 10).winner) peeked = true;
      }
      if (peeked) peekingWins++;
      if (compareVariants(cA, n, cB, n).winner) fixedHorizonWins++;
    }
    expect(fixedHorizonWins / runs).toBeGreaterThan(0.03);
    expect(fixedHorizonWins / runs).toBeLessThan(0.07);
    expect(peekingWins / runs).toBeGreaterThan(0.12);
  });
});

describe("A/B in the mock channel", () => {
  const bench = getBenchmark("food_beverage", "cart_abandoners");
  const start = new Date("2026-11-01T03:30:00Z");
  const campaign = {
    id: "ab-sim",
    dailyBudgetPaise: 300_000,
    lifetimeBudgetPaise: 4_200_000,
    startAt: start,
    endAt: new Date(start.getTime() + 14 * DAY),
    freqCapDay: 3,
    treatedUsers: 9000,
    holdoutUsers: 1000,
    bench,
    aovPaise: 89_900,
    totalSpendPaise: 0,
  };

  it("leaves campaigns without a test unchanged", () => {
    const r = simulateDelivery(campaign, start, new Date(start.getTime() + 2 * DAY), {}, 10_000_000);
    expect(r.ab).toBeNull();
  });

  it("splits test traffic until each variant has its sample, within the test budget", () => {
    const n = 20_000;
    const cap = 4_200_000 * AB_MAX_BUDGET_SHARE;
    const stats: Record<string, DayStat> = {};
    const r = simulateDelivery({ ...campaign, ab: { ctrMultiplierB: 1.25, needA: n, needB: n, budgetLeftPaise: cap } }, start, new Date(start.getTime() + 10 * DAY), stats, 10_000_000);
    expect(r.ab).not.toBeNull();
    expect(r.ab!.impressionsA).toBeGreaterThanOrEqual(n * 0.99);
    expect(r.ab!.impressionsB).toBeGreaterThanOrEqual(n * 0.99);
    // Stops splitting once done: neither variant runs far past its sample.
    expect(r.ab!.impressionsA).toBeLessThan(n * 1.1);
    expect(r.ab!.spendPaise).toBeLessThanOrEqual(cap + 1);
    // B's true CTR is 25% higher; observed CTR should land close to that.
    const lift = r.ab!.clicksB / r.ab!.impressionsB / (r.ab!.clicksA / r.ab!.impressionsA) - 1;
    expect(lift).toBeGreaterThan(0.1);
    expect(lift).toBeLessThan(0.4);
  });

  it("stops the test at the test budget cap", () => {
    const cap = 50_000; // ₹500
    const r = simulateDelivery({ ...campaign, ab: { ctrMultiplierB: 1, needA: 1e9, needB: 1e9, budgetLeftPaise: cap } }, start, new Date(start.getTime() + 3 * DAY), {}, 10_000_000);
    expect(r.ab!.spendPaise).toBeLessThanOrEqual(cap + 1);
    expect(r.spentPaise).toBeGreaterThan(cap); // the campaign keeps delivering variant A
  });

  it("gives hidden true effects a realistic spread, deterministic per test", () => {
    expect(simTrueEffect("t1")).toBe(simTrueEffect("t1"));
    const effects = Array.from({ length: 500 }, (_, i) => simTrueEffect(`test-${i}`));
    const tiny = effects.filter((e) => Math.abs(e) <= 0.04).length / effects.length;
    expect(tiny).toBeGreaterThan(0.25);
    expect(tiny).toBeLessThan(0.45);
    expect(Math.max(...effects.map(Math.abs))).toBeLessThanOrEqual(0.35);
  });
});

import { describe, expect, it } from "vitest";
import { suggestBudget, MIN_DAILY_PAISE, type BudgetSuggesterInput } from "../ai/budget-suggester";
import { getBenchmark } from "../benchmarks";
import { peaksOverlapping } from "../calendar";
import { formatINR } from "../format";
import { holdoutBucket, isHoldout } from "../holdout";
import { checkCreative, withUtm } from "../policy";
import { can, needsApproval } from "../rbac";
import { simulateDelivery, type DayStat } from "../sim/engine";
import { computeLift, computeNsm } from "../stats";
import { DAY, istDayKey, istHourStart } from "../time";

const bench = getBenchmark("food_beverage", "cart_abandoners");
const baseInput: BudgetSuggesterInput = {
  personaKey: "cart_abandoners",
  personaName: "Cart abandoners",
  bench,
  treatedUsers: 4000,
  freqCapDay: 4,
  durationDays: 14,
  aovPaise: 89_900,
  walletAvailablePaise: 10_000_000,
  history: [],
};

describe("format", () => {
  it("uses Indian digit grouping", () => {
    expect(formatINR(150_000_00)).toBe("₹1,50,000");
  });
});

describe("time (IST)", () => {
  it("rolls the day over at IST midnight, not UTC", () => {
    expect(istDayKey(new Date("2026-11-10T18:29:00Z"))).toBe("2026-11-10");
    expect(istDayKey(new Date("2026-11-10T18:31:00Z"))).toBe("2026-11-11");
  });
  it("aligns hour buckets to IST hours", () => {
    expect(istHourStart(new Date("2026-11-10T10:45:00Z")).toISOString()).toBe("2026-11-10T10:30:00.000Z");
  });
});

describe("holdout", () => {
  it("is deterministic per shopper and brand", () => {
    expect(holdoutBucket("abc", "salt")).toBe(holdoutBucket("abc", "salt"));
    // Different brands (salts) must not share the same holdout members.
    let same = 0;
    for (let i = 0; i < 1000; i++) if (holdoutBucket(`u${i}`, "brand-a") === holdoutBucket(`u${i}`, "brand-b")) same++;
    expect(same).toBeLessThan(50);
  });
  it("assigns roughly holdoutPct of shoppers", () => {
    let n = 0;
    for (let i = 0; i < 20_000; i++) if (isHoldout(holdoutBucket(`user-${i}`, "s"), 10)) n++;
    expect(n / 20_000).toBeGreaterThan(0.09);
    expect(n / 20_000).toBeLessThan(0.11);
  });
});

describe("budget suggester", () => {
  it("withholds the number when there is no history (low confidence)", () => {
    const s = suggestBudget(baseInput);
    expect(s.confidence).toBe("low");
    expect(s.status).toBe("insufficient_data");
  });

  it("never exceeds the wallet over the schedule", () => {
    const s = suggestBudget({ ...baseInput, walletAvailablePaise: 14 * 80_000, history: [{ personaKey: "x", days: 10, spendPaise: 5_000_000, clicks: 100, conversions: 2, revenuePaise: 0 }] });
    expect(s.recommendedDailyPaise * 14).toBeLessThanOrEqual(14 * 80_000);
    expect(s.guardrails.find((g) => g.label === "Wallet balance")?.binding).toBe(true);
  });

  it("never exceeds 2× the highest past daily spend", () => {
    const s = suggestBudget({ ...baseInput, treatedUsers: 1_000_000, history: [{ personaKey: "cart_abandoners", days: 10, spendPaise: 1_000_000, clicks: 1000, conversions: 60, revenuePaise: 5_000_000 }] });
    expect(s.recommendedDailyPaise).toBeLessThanOrEqual(200_000);
  });

  it("respects audience saturation and the platform minimum", () => {
    const s = suggestBudget({ ...baseInput, treatedUsers: 100, history: [{ personaKey: "lapsed_buyers", days: 10, spendPaise: 10_000_000, clicks: 1, conversions: 0, revenuePaise: 0 }] });
    expect(s.recommendedDailyPaise).toBe(MIN_DAILY_PAISE);
  });

  it("gives three plain-language reasons including peak season", () => {
    const s = suggestBudget({ ...baseInput, peak: { name: "Black Friday", cpcFactor: 1.3, cvrFactor: 1.2 }, history: [{ personaKey: "cart_abandoners", days: 14, spendPaise: 2_000_000, clicks: 2500, conversions: 140, revenuePaise: 12_000_000 }] });
    expect(s.reasons).toHaveLength(3);
    expect(s.reasons[2]).toContain("Black Friday");
  });
});

describe("delivery simulator (mock channel)", () => {
  const camp = {
    id: "c1",
    dailyBudgetPaise: 200_000,
    lifetimeBudgetPaise: 500_000,
    startAt: new Date("2026-11-01T04:30:00Z"),
    endAt: new Date("2026-11-15T04:30:00Z"),
    freqCapDay: 4,
    treatedUsers: 50_000,
    holdoutUsers: 5_000,
    bench,
    aovPaise: 89_900,
    totalSpendPaise: 0,
  };

  it("never spends more than the daily budget in an IST day", () => {
    const stats: Record<string, DayStat> = {};
    simulateDelivery(camp, camp.startAt, new Date(camp.startAt.getTime() + 2 * DAY), stats, Infinity);
    for (const d of Object.values(stats)) expect(d.spendPaise).toBeLessThanOrEqual(camp.dailyBudgetPaise + 1);
  });

  it("stops at the lifetime ceiling", () => {
    const r = simulateDelivery(camp, camp.startAt, camp.endAt, {}, Infinity);
    expect(r.spentPaise).toBeLessThanOrEqual(camp.lifetimeBudgetPaise + 1);
    expect(r.reachedLifetimeCap).toBe(true);
  });

  it("stops before overshooting the wallet (channel-side cap)", () => {
    const r = simulateDelivery(camp, camp.startAt, camp.endAt, {}, 150_000);
    expect(r.spentPaise).toBeLessThanOrEqual(150_001);
    expect(r.walletExhausted).toBe(true);
  });

  it("respects the frequency cap", () => {
    const small = { ...camp, treatedUsers: 500, dailyBudgetPaise: 10_000_000, lifetimeBudgetPaise: 100_000_000 };
    const stats: Record<string, DayStat> = {};
    simulateDelivery(small, small.startAt, new Date(small.startAt.getTime() + 3 * DAY), stats, Infinity);
    for (const d of Object.values(stats)) expect(d.impressions).toBeLessThanOrEqual(500 * 4 + 1);
  });

  it("is deterministic", () => {
    const a = simulateDelivery(camp, camp.startAt, new Date(camp.startAt.getTime() + DAY), {}, Infinity);
    const b = simulateDelivery(camp, camp.startAt, new Date(camp.startAt.getTime() + DAY), {}, Infinity);
    expect(a.spentPaise).toBe(b.spentPaise);
  });
});

describe("measurement", () => {
  it("flags insufficient data below 20 conversions per group", () => {
    expect(computeLift(10, 1000, 5, 100).status).toBe("insufficient_data");
  });
  it("detects a real lift with enough data", () => {
    const l = computeLift(600, 10_000, 40, 1_000);
    expect(l.relativeLift).toBeCloseTo(0.5, 5);
    expect(l.significant).toBe(true);
  });
  it("calls a small difference inconclusive", () => {
    expect(computeLift(105, 5_000, 20, 1_000).significant).toBe(false);
  });
  it("computes NSM over unique engaged customers", () => {
    expect(computeNsm(100, 17)).toBeCloseTo(20, 5);
  });
});

describe("policy", () => {
  const ok = { headline: "Still thinking it over?", body: "Your coffee is waiting.", cta: "Shop now", landingUrl: "https://kaapi.example/x" };
  it("passes a clean creative", () => expect(checkCreative(ok).ok).toBe(true));
  it("blocks prohibited claims and non-https links", () => {
    const r = checkCreative({ ...ok, body: "Guaranteed results or money back", landingUrl: "http://x.com" });
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThanOrEqual(2);
  });
  it("adds UTM tags", () => expect(withUtm("https://a.com/p", "CMP-1")).toContain("utm_campaign=CMP-1"));
});

describe("rbac", () => {
  it("only owner/admin can raise caps; only owner tops up", () => {
    expect(can("editor", "campaign:raise_lifetime_cap")).toBe(false);
    expect(can("admin", "campaign:raise_lifetime_cap")).toBe(true);
    expect(can("admin", "wallet:topup")).toBe(false);
    expect(can("viewer", "campaign:pause")).toBe(false);
  });
  it("editor launches above ₹50,000 need approval", () => {
    expect(needsApproval("editor", 50_001_00)).toBe(true);
    expect(needsApproval("editor", 50_000_00)).toBe(false);
    expect(needsApproval("admin", 10_00_000_00)).toBe(false);
  });
});

describe("calendar", () => {
  it("finds overlapping peak seasons", () => {
    expect(peaksOverlapping("2026-11-20", "2026-11-26").map((p) => p.key)).toContain("bfcm-2026");
  });
});

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { deriveCustomerAttributes } from "../customer-attributes";
import { seededRng } from "../rng";
import {
  assignLifecycle,
  benchKeyFor,
  DEFAULT_DEFINITION,
  definitionSchema,
  describeDefinition,
  eligibility,
  EMPTY_FILTERS,
  isControlRank,
  quarterKey,
  SMART_PRESETS,
  type CustomerRecord,
} from "../segment-defs";
import { aggregateFunnel } from "../segments";

const DAY = 86_400_000;
const now = new Date("2026-11-11T06:30:00Z");
const ago = (d: number) => new Date(now.getTime() - d * DAY);
const cust = (o: Partial<CustomerRecord>): CustomerRecord => ({
  customerId: "KC-1",
  lastOnlinePurchaseAt: null,
  lastStorePurchaseAt: null,
  groupLastOnlinePurchaseAt: null,
  groupLastStorePurchaseAt: null,
  ...o,
});
const def = { channel: "any" as const, p1Days: 90, p2Days: 270 };

describe("Rule 1: eligibility", () => {
  it("needs a valid customer ID", () => {
    expect(eligibility(cust({ customerId: null, lastOnlinePurchaseAt: ago(5) }), "any")).toBe("no_customer_id");
  });
  it("needs a purchase through the campaign's channel (brand or group)", () => {
    const storeOnly = cust({ lastStorePurchaseAt: ago(5) });
    expect(eligibility(storeOnly, "online")).toBe("other_channel");
    expect(eligibility(storeOnly, "store")).toBe("eligible");
    expect(eligibility(storeOnly, "any")).toBe("eligible");
    expect(eligibility(cust({ groupLastOnlinePurchaseAt: ago(400) }), "online")).toBe("eligible");
  });
});

describe("Rule 2: lifecycle (ordered, first match wins)", () => {
  it("assigns Active, Inactive, Potential and Out of scope", () => {
    expect(assignLifecycle(cust({ lastOnlinePurchaseAt: ago(10) }), def, now)).toBe("active");
    expect(assignLifecycle(cust({ lastOnlinePurchaseAt: ago(200) }), def, now)).toBe("inactive");
    expect(assignLifecycle(cust({ groupLastStorePurchaseAt: ago(20) }), def, now)).toBe("potential");
    expect(assignLifecycle(cust({ lastOnlinePurchaseAt: ago(500), groupLastOnlinePurchaseAt: ago(400) }), def, now)).toBe("out_of_scope");
  });
  it("prefers the earlier rule when several match", () => {
    // Bought from the brand in P1 AND from a sister brand: Active, not Potential.
    expect(assignLifecycle(cust({ lastStorePurchaseAt: ago(10), groupLastOnlinePurchaseAt: ago(5) }), def, now)).toBe("active");
    // Brand purchase in P2 beats a recent group purchase: Inactive.
    expect(assignLifecycle(cust({ lastStorePurchaseAt: ago(150), groupLastOnlinePurchaseAt: ago(5) }), def, now)).toBe("inactive");
  });
  it("only counts purchases through the chosen channel", () => {
    const c = cust({ lastStorePurchaseAt: ago(10), lastOnlinePurchaseAt: ago(200) });
    expect(assignLifecycle(c, { ...def, channel: "store" }, now)).toBe("active");
    expect(assignLifecycle(c, { ...def, channel: "online" }, now)).toBe("inactive");
  });
  it("respects custom P1 / P2 lengths", () => {
    const c = cust({ lastOnlinePurchaseAt: ago(45) });
    expect(assignLifecycle(c, { ...def, p1Days: 30, p2Days: 60 }, now)).toBe("inactive");
    expect(assignLifecycle(c, { ...def, p1Days: 60, p2Days: 60 }, now)).toBe("active");
  });
});

describe("Rule 3: stratified target/control split", () => {
  it("takes exactly ⌊n·pct/100⌋ from every stratum, spread evenly", () => {
    for (const n of [7, 10, 99, 100, 1234]) {
      const picked = Array.from({ length: n }, (_, i) => isControlRank(i + 1, 10)).filter(Boolean).length;
      expect(picked).toBe(Math.floor(n * 0.1));
    }
    // evenly spread: never two control picks within 9 ranks of each other at 10%
    const ranks = Array.from({ length: 200 }, (_, i) => i + 1).filter((r) => isControlRank(r, 10));
    expect(ranks.slice(1).every((r, i) => r - ranks[i] === 10)).toBe(true);
  });
  it("gives every lifecycle segment the same control share on generated customers", () => {
    const rng = seededRng("strata-test");
    const strata = new Map<string, { h: string; seg: string }[]>();
    for (let i = 0; i < 20_000; i++) {
      const idHash = createHash("sha256").update(`c${i}`).digest("hex");
      const bought = rng() < 0.6;
      const last = bought ? ago(Math.pow(rng(), 1.6) * 365) : null;
      const a = deriveCustomerAttributes({ idHash, hasEmail: true, lastPurchaseAt: last, purchaseCount: bought ? 1 + Math.floor(rng() * 5) : 0, totalSpendPaise: bought ? 150_000 : 0 }, now, 89_900);
      if (eligibility(a, "any") !== "eligible") continue;
      const seg = assignLifecycle(a, def, now);
      const key = `${seg}|${a.valueTier}`;
      const list = strata.get(key) ?? [];
      list.push({ h: createHash("md5").update(idHash + "salt" + quarterKey(now)).digest("hex"), seg });
      strata.set(key, list);
    }
    const bySeg = new Map<string, { n: number; control: number }>();
    for (const list of strata.values()) {
      list.sort((x, y) => (x.h < y.h ? -1 : 1));
      list.forEach((m, i) => {
        const s = bySeg.get(m.seg) ?? { n: 0, control: 0 };
        s.n++;
        if (isControlRank(i + 1, 10)) s.control++;
        bySeg.set(m.seg, s);
      });
    }
    for (const [seg, s] of bySeg) {
      if (s.n < 500) continue;
      expect(s.control / s.n, seg).toBeGreaterThan(0.095);
      expect(s.control / s.n, seg).toBeLessThanOrEqual(0.1);
    }
  });
  it("freezes per IST quarter", () => {
    expect(quarterKey(new Date("2026-12-31T18:29:00Z"))).toBe("2026-Q4");
    expect(quarterKey(new Date("2026-12-31T18:31:00Z"))).toBe("2027-Q1");
    expect(quarterKey(new Date("2026-11-11T00:00:00Z"))).toBe("2026-Q4");
  });
});

describe("Funnel aggregation (Rules 1–5 counts)", () => {
  const row = (seg: string, o: Partial<{ pass: boolean; control: boolean; dnc: boolean; optout: boolean; matched: boolean }>, n: number) => ({
    seg,
    pass: true,
    control: false,
    dnc: false,
    optout: false,
    matched: true,
    ...o,
    n,
  });
  const f = aggregateFunnel(
    [
      row("no_customer_id", {}, 50),
      row("other_channel", {}, 20),
      row("out_of_scope", {}, 30),
      row("active", {}, 400),
      row("inactive", {}, 900),
      row("inactive", { pass: false }, 300), // filtered out by Rule 5
      row("inactive", { control: true }, 100),
      row("inactive", { control: true, dnc: true }, 5), // control, but not comparable
      row("inactive", { dnc: true }, 10),
      row("inactive", { dnc: true, optout: true }, 4), // counted once, as do-not-contact
      row("inactive", { optout: true }, 20),
      row("inactive", { matched: false }, 60),
      row("potential", {}, 70),
    ],
    { segments: ["inactive"] },
    { holdoutPct: 10, controlPeriodKey: "2026-Q4" },
  );
  it("counts eligibility and the full lifecycle distribution before narrowing", () => {
    expect(f.profiles).toBe(1969);
    expect(f.noCustomerId).toBe(50);
    expect(f.otherChannel).toBe(20);
    expect(f.eligible).toBe(1899);
    expect(f.distribution).toEqual({ active: 400, inactive: 1399, potential: 70, out_of_scope: 30 });
  });
  it("applies narrowing, the split and contactability in order, counting each person once", () => {
    const s = f.selected;
    expect(s.matching).toBe(1099);
    expect(s.controlRaw).toBe(105);
    expect(s.control).toBe(100);
    expect(s.target).toBe(994);
    expect(s.doNotContact).toBe(14);
    expect(s.optedOut).toBe(20);
    expect(s.unreachable).toBe(60);
    expect(s.contactable).toBe(900);
    expect(s.doNotContact + s.optedOut + s.unreachable + s.contactable).toBe(s.target);
  });
});

describe("definitions", () => {
  it("validates", () => {
    expect(definitionSchema.safeParse(DEFAULT_DEFINITION).success).toBe(true);
    expect(definitionSchema.safeParse({ ...DEFAULT_DEFINITION, segments: [] }).success).toBe(false);
    expect(definitionSchema.safeParse({ ...DEFAULT_DEFINITION, filters: { ...EMPTY_FILTERS, stores: ["Nowhere"] } }).success).toBe(false);
    for (const p of Object.values(SMART_PRESETS)) expect(definitionSchema.safeParse(p.def).success).toBe(true);
  });
  it("maps custom audiences to the closest Smart Persona for benchmarks", () => {
    expect(benchKeyFor(SMART_PRESETS.cart_abandoners.def)).toBe("cart_abandoners");
    expect(benchKeyFor({ ...DEFAULT_DEFINITION, segments: ["inactive"] })).toBe("lapsed_buyers");
    expect(benchKeyFor({ ...DEFAULT_DEFINITION, segments: ["active"], filters: { ...EMPTY_FILTERS, valueTiers: ["premium"] } })).toBe("high_value");
    expect(benchKeyFor({ ...DEFAULT_DEFINITION, segments: ["potential"] })).toBe("repeat_browsers");
  });
  it("describes itself in plain language", () => {
    const lines = describeDefinition({ ...DEFAULT_DEFINITION, filters: { ...EMPTY_FILTERS, regions: ["south"], promo: ["deal_seeker"] } });
    expect(lines.join(" ")).toContain("Inactive");
    expect(lines.join(" ")).toContain("South");
    expect(lines.join(" ")).toContain("Deal seeker");
  });
});

describe("mock customer data", () => {
  const base = { idHash: "a".repeat(64), hasEmail: true, lastPurchaseAt: ago(40), purchaseCount: 3, totalSpendPaise: 300_000 };
  it("is deterministic and consistent with the purchase history", () => {
    const a = deriveCustomerAttributes(base, now, 89_900);
    expect(deriveCustomerAttributes(base, now, 89_900)).toEqual(a);
    const latest = [a.lastOnlinePurchaseAt, a.lastStorePurchaseAt].filter(Boolean).map((d) => d!.getTime());
    expect(Math.max(...latest)).toBe(base.lastPurchaseAt.getTime());
  });
  it("gives anonymous visitors no customer ID and never-buyers no value tier", () => {
    const anon = deriveCustomerAttributes({ ...base, hasEmail: false, lastPurchaseAt: null, purchaseCount: 0, totalSpendPaise: 0 }, now, 89_900);
    expect(anon.customerId).toBeNull();
    expect(anon.valueTier).toBe("none");
    expect(anon.lastOnlinePurchaseAt).toBeNull();
  });
});

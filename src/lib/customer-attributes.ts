import { seededRng } from "./rng";
import { CATEGORIES, REGIONS, STORES } from "./segment-defs";

// Mock customer-data generator (stands in for the CRM / POS / loyalty feeds). Deterministic per
// profile hash, so the seed and the backfill script produce identical data.

const DAY = 86_400_000;

export interface ProfileBasics {
  idHash: string;
  hasEmail: boolean;
  lastPurchaseAt: Date | null;
  purchaseCount: number;
  totalSpendPaise: number;
}

export interface CustomerAttributes {
  customerId: string | null;
  lastOnlinePurchaseAt: Date | null;
  lastStorePurchaseAt: Date | null;
  groupLastOnlinePurchaseAt: Date | null;
  groupLastStorePurchaseAt: Date | null;
  visits12m: number;
  valueTier: string;
  fullPriceShare: number;
  lifeStage: string;
  ageBand: string;
  incomeBand: string;
  nationality: string;
  language: string;
  loyaltyTier: string;
  categories: string[];
  region: string;
  homeStore: string | null;
  doNotContact: boolean;
  adsOptOut: boolean;
}

function pick<T>(r: () => number, items: readonly T[], weights: readonly number[]): T {
  let x = r() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < items.length; i++) {
    x -= weights[i];
    if (x <= 0) return items[i];
  }
  return items[items.length - 1];
}

const LANG_BY_REGION: Record<(typeof REGIONS)[number], [string[], number[]]> = {
  north: [["english", "hindi"], [0.5, 0.5]],
  south: [["english", "tamil", "kannada", "telugu"], [0.4, 0.2, 0.25, 0.15]],
  east: [["english", "bengali", "hindi"], [0.4, 0.45, 0.15]],
  west: [["english", "marathi", "hindi"], [0.5, 0.3, 0.2]],
};

export function valueTierFor(totalSpendPaise: number, visits12m: number, aovPaise: number, boughtInLastYear: boolean): string {
  if (!boughtInLastYear) return "none";
  const x = totalSpendPaise / aovPaise;
  if (x >= 4.5 && visits12m >= 8) return "premium";
  if (x >= 2.5 || (x >= 1.8 && visits12m >= 6)) return "high";
  if (x >= 1.2) return "medium";
  return "low";
}

export function deriveCustomerAttributes(p: ProfileBasics, now: Date, aovPaise: number): CustomerAttributes {
  const r = seededRng(p.idHash, "customer-v1");
  const daysAgo = (d: number) => new Date(now.getTime() - d * DAY);

  // Rule 1 inputs: a CRM ID exists for most known customers; a few records are invalid.
  const customerId = p.hasEmail ? (r() < 0.985 ? `KC-${p.idHash.slice(0, 16).toUpperCase()}` : null) : null;

  // Brand purchases by channel.
  let lastOnlinePurchaseAt: Date | null = null;
  let lastStorePurchaseAt: Date | null = null;
  if (p.lastPurchaseAt) {
    const mix = r();
    if (mix < 0.5) lastOnlinePurchaseAt = p.lastPurchaseAt;
    else if (mix < 0.75) lastStorePurchaseAt = p.lastPurchaseAt;
    else {
      const other = new Date(p.lastPurchaseAt.getTime() - (5 + r() * 150) * DAY);
      if (r() < 0.6) [lastOnlinePurchaseAt, lastStorePurchaseAt] = [p.lastPurchaseAt, other];
      else [lastOnlinePurchaseAt, lastStorePurchaseAt] = [other, p.lastPurchaseAt];
    }
  }

  // Purchases at other brands in the group (drives the "Potential" segment).
  let groupLastOnlinePurchaseAt: Date | null = null;
  let groupLastStorePurchaseAt: Date | null = null;
  if (customerId && r() < (p.lastPurchaseAt ? 0.3 : 0.5)) {
    const when = daysAgo(Math.pow(r(), 1.3) * 420);
    const ch = r();
    if (ch < 0.55) groupLastOnlinePurchaseAt = when;
    else if (ch < 0.85) groupLastStorePurchaseAt = when;
    else {
      groupLastOnlinePurchaseAt = when;
      groupLastStorePurchaseAt = daysAgo((now.getTime() - when.getTime()) / DAY + r() * 90);
    }
  }

  const boughtInLastYear = Boolean(p.lastPurchaseAt && p.lastPurchaseAt.getTime() >= now.getTime() - 365 * DAY);
  const visits12m = p.lastPurchaseAt ? Math.round(p.purchaseCount * (1.2 + r() * 2.5) + (lastStorePurchaseAt ? r() * 4 : 0)) : Math.floor(r() * 3);
  const valueTier = valueTierFor(p.totalSpendPaise, visits12m, aovPaise, boughtInLastYear);
  const dealLean = valueTier === "low" ? 0.6 : valueTier === "premium" ? 1.6 : 1;
  const fullPriceShare = Math.round(Math.min(1, Math.pow(r(), 0.8 / dealLean)) * 100) / 100;

  const known = Boolean(customerId);
  const region = known ? pick(r, REGIONS, [0.2, 0.45, 0.1, 0.25]) : "unknown";
  const shared = known && r() < 0.75; // shared demographics with the loyalty programme
  const [langs, langW] = region === "unknown" ? [["unknown"], [1]] : LANG_BY_REGION[region as (typeof REGIONS)[number]];

  const anyStore = Boolean(lastStorePurchaseAt || groupLastStorePurchaseAt);
  const homeStore = anyStore && region !== "unknown" ? pick(r, STORES[region as (typeof REGIONS)[number]], STORES[region as (typeof REGIONS)[number]].map(() => 1)) : null;

  const loyaltyTier = !known
    ? "none"
    : valueTier === "premium"
      ? pick(r, ["platinum", "gold"], [0.7, 0.3])
      : valueTier === "high"
        ? pick(r, ["gold", "silver"], [0.55, 0.45])
        : valueTier === "medium"
          ? pick(r, ["silver", "none"], [0.5, 0.5])
          : pick(r, ["silver", "none"], [0.1, 0.9]);

  const nCats = p.lastPurchaseAt ? 1 + Math.floor(r() * 3) : groupLastOnlinePurchaseAt || groupLastStorePurchaseAt ? 1 : 0;
  const categories = new Set<string>();
  for (let i = 0; i < nCats; i++) categories.add(pick(r, CATEGORIES, [0.3, 0.25, 0.15, 0.12, 0.12, 0.06]));

  return {
    customerId,
    lastOnlinePurchaseAt,
    lastStorePurchaseAt,
    groupLastOnlinePurchaseAt,
    groupLastStorePurchaseAt,
    visits12m,
    valueTier,
    fullPriceShare,
    lifeStage: known ? pick(r, ["single", "couple", "family"], [0.38, 0.3, 0.32]) : "unknown",
    ageBand: shared ? pick(r, ["18-24", "25-34", "35-44", "45-54", "55+"], [0.14, 0.36, 0.26, 0.15, 0.09]) : "unknown",
    incomeBand: shared ? pick(r, ["low", "middle", "upper_middle", "high"], [0.18, 0.42, 0.28, 0.12]) : "unknown",
    nationality: shared ? (r() < 0.94 ? "indian" : "other") : "unknown",
    language: pick(r, langs, langW),
    loyaltyTier,
    categories: [...categories],
    region,
    homeStore,
    doNotContact: known && r() < 0.025,
    adsOptOut: r() < 0.04,
  };
}

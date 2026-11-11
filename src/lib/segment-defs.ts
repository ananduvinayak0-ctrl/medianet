import { z } from "zod";
import type { PersonaKey } from "./domain";

// Custom audience segmentation: the rules, option lists and pure helpers shared by the
// builder UI, the SQL engine (segments.ts), the data generator and tests.
//
//   Rule 1  Eligibility      valid unique customer ID + bought through the campaign's channel
//   Rule 2  Lifecycle        Active → Inactive → Potential → Out of scope (first match wins)
//   Rule 3  Target/Control   stratified random split, frozen for the quarter (control-group.ts)
//   Rule 4  Contactability   target only; drop global do-not-contact and channel opt-outs
//   Rule 5  Narrowing        optional value / promo / life stage / demographics / affinity / geo
//   Rule 6  Measurement      target vs control on every campaign (lift card)

const DAY = 86_400_000;

// ---------- Rule 1: purchase channel ----------
export const PURCHASE_CHANNELS = ["online", "store", "any"] as const;
export type PurchaseChannel = (typeof PURCHASE_CHANNELS)[number];
export const CHANNEL_LABEL: Record<PurchaseChannel, string> = { online: "Online", store: "Stores", any: "Online and stores" };

// ---------- Rule 2: lifecycle ----------
export const LIFECYCLE = ["active", "inactive", "potential", "out_of_scope"] as const;
export type Lifecycle = (typeof LIFECYCLE)[number];
export const TARGETABLE = ["active", "inactive", "potential"] as const;
export type TargetableSegment = (typeof TARGETABLE)[number];

export const LIFECYCLE_INFO: Record<Lifecycle, { label: string; rule: string }> = {
  active: { label: "Active", rule: "Bought from the brand in P1" },
  inactive: { label: "Inactive", rule: "Didn't buy in P1, but did in P2" },
  potential: { label: "Potential", rule: "Didn't buy from the brand in P1 or P2, but bought from another brand in the group" },
  out_of_scope: { label: "Out of scope", rule: "None of the above" },
};

// ---------- Rule 5: optional narrowing ----------
export const VALUE_TIERS = ["low", "medium", "high", "premium"] as const;
export const PROMO_SENSITIVITY = ["full_price", "mixed", "deal_seeker"] as const;
export const LIFE_STAGES = ["single", "couple", "family"] as const;
export const AGE_BANDS = ["18-24", "25-34", "35-44", "45-54", "55+"] as const;
export const INCOME_BANDS = ["low", "middle", "upper_middle", "high"] as const;
export const NATIONALITIES = ["indian", "other"] as const;
export const LANGUAGES = ["english", "hindi", "tamil", "kannada", "telugu", "marathi", "bengali"] as const;
export const LOYALTY_TIERS = ["none", "silver", "gold", "platinum"] as const;
export const CATEGORIES = ["coffee_beans", "filter_coffee", "cold_brew", "tea", "snacks", "merch"] as const;
export const REGIONS = ["north", "south", "east", "west"] as const;
export const STORES: Record<(typeof REGIONS)[number], string[]> = {
  north: ["Delhi · Khan Market", "Gurugram · Cyber Hub"],
  south: ["Bengaluru · Indiranagar", "Chennai · Besant Nagar", "Hyderabad · Jubilee Hills"],
  east: ["Kolkata · Park Street"],
  west: ["Mumbai · Bandra", "Pune · Koregaon Park"],
};
export const ALL_STORES = Object.values(STORES).flat();
/** Smart Persona behaviours that can narrow any custom audience. */
export const SIGNALS = ["cart_abandoned", "repeat_viewer"] as const;

export const OPTION_LABEL: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  premium: "Premium",
  full_price: "Full price (80%+ of spend)",
  mixed: "Mixed (40–80%)",
  deal_seeker: "Deal seeker (<40%)",
  single: "Single",
  couple: "Couple",
  family: "Family",
  middle: "Middle",
  upper_middle: "Upper middle",
  indian: "Indian",
  other: "Other",
  english: "English",
  hindi: "Hindi",
  tamil: "Tamil",
  kannada: "Kannada",
  telugu: "Telugu",
  marathi: "Marathi",
  bengali: "Bengali",
  none: "None",
  silver: "Silver",
  gold: "Gold",
  platinum: "Platinum",
  coffee_beans: "Coffee beans",
  filter_coffee: "Filter coffee",
  cold_brew: "Cold brew",
  tea: "Tea",
  snacks: "Snacks",
  merch: "Merchandise",
  north: "North",
  south: "South",
  east: "East",
  west: "West",
  cart_abandoned: "Abandoned a cart (last 7 days)",
  repeat_viewer: "Viewed products 2+ times (last 14 days)",
};
export const label = (v: string) => OPTION_LABEL[v] ?? v;

const many = <T extends readonly [string, ...string[]]>(values: T) => z.array(z.enum(values)).max(values.length).default([]);

export const filtersSchema = z.object({
  valueTiers: many(VALUE_TIERS),
  promo: many(PROMO_SENSITIVITY),
  lifeStages: many(LIFE_STAGES),
  ageBands: many(AGE_BANDS),
  incomeBands: many(INCOME_BANDS),
  nationalities: many(NATIONALITIES),
  languages: many(LANGUAGES),
  loyaltyTiers: many(LOYALTY_TIERS),
  categories: many(CATEGORIES),
  regions: many(REGIONS),
  stores: z.array(z.string().refine((s) => ALL_STORES.includes(s), "Unknown store")).max(ALL_STORES.length).default([]),
  signals: many(SIGNALS),
});
export type SegmentFilters = z.infer<typeof filtersSchema>;

export const definitionSchema = z.object({
  channel: z.enum(PURCHASE_CHANNELS),
  p1Days: z.number().int().min(7, "P1 must be at least 7 days").max(365),
  p2Days: z.number().int().min(7, "P2 must be at least 7 days").max(730),
  segments: z.array(z.enum(TARGETABLE)).min(1, "Pick at least one lifecycle segment to target"),
  filters: filtersSchema.default({}),
});
export type SegmentDefinition = z.infer<typeof definitionSchema>;

export const EMPTY_FILTERS: SegmentFilters = filtersSchema.parse({});

export const DEFAULT_DEFINITION: SegmentDefinition = { channel: "any", p1Days: 90, p2Days: 270, segments: ["inactive"], filters: EMPTY_FILTERS };

/** Filter groups as shown in the builder (Rule 5 headings). */
export const FILTER_GROUPS: { title: string; hint: string; fields: { key: keyof SegmentFilters; label: string; options: readonly string[] }[] }[] = [
  { title: "Value", hint: "Spend and visit frequency over the last 12 months", fields: [{ key: "valueTiers", label: "Value tier", options: VALUE_TIERS }] },
  { title: "Promo sensitivity", hint: "How much of their spend is at full price versus on sale", fields: [{ key: "promo", label: "Buying behaviour", options: PROMO_SENSITIVITY }] },
  { title: "Life stage", hint: "Inferred from what they buy", fields: [{ key: "lifeStages", label: "Life stage", options: LIFE_STAGES }] },
  {
    title: "Demographics",
    hint: "From the loyalty programme, where the customer shared it",
    fields: [
      { key: "ageBands", label: "Age", options: AGE_BANDS },
      { key: "incomeBands", label: "Income", options: INCOME_BANDS },
      { key: "nationalities", label: "Nationality", options: NATIONALITIES },
      { key: "languages", label: "Language", options: LANGUAGES },
      { key: "loyaltyTiers", label: "Loyalty tier", options: LOYALTY_TIERS },
    ],
  },
  { title: "Product affinity", hint: "Categories they've bought from (any of)", fields: [{ key: "categories", label: "Categories", options: CATEGORIES }] },
  {
    title: "Geography",
    hint: "Home region, or the store they use most",
    fields: [
      { key: "regions", label: "Region", options: REGIONS },
      { key: "stores", label: "Store", options: ALL_STORES },
    ],
  },
  { title: "Behaviour (Smart Persona signals)", hint: "Recent intent from your pixel", fields: [{ key: "signals", label: "Signal", options: SIGNALS }] },
];

export function activeFilterCount(f: SegmentFilters): number {
  return (Object.keys(f) as (keyof SegmentFilters)[]).filter((k) => f[k].length > 0).length;
}

// ---------- Smart Personas as presets ----------
export const SMART_PRESETS: Record<PersonaKey, { name: string; def: SegmentDefinition }> = {
  cart_abandoners: { name: "Cart abandoners", def: { channel: "online", p1Days: 90, p2Days: 270, segments: ["active", "inactive", "potential"], filters: { ...EMPTY_FILTERS, signals: ["cart_abandoned"] } } },
  repeat_browsers: { name: "Repeat product viewers", def: { channel: "online", p1Days: 90, p2Days: 270, segments: ["active", "inactive", "potential"], filters: { ...EMPTY_FILTERS, signals: ["repeat_viewer"] } } },
  recent_buyers: { name: "Recent buyers (cross-sell)", def: { channel: "any", p1Days: 30, p2Days: 60, segments: ["active"], filters: EMPTY_FILTERS } },
  lapsed_buyers: { name: "Lapsed buyers", def: { channel: "any", p1Days: 30, p2Days: 60, segments: ["inactive"], filters: EMPTY_FILTERS } },
  high_value: { name: "High-value customers", def: { channel: "any", p1Days: 90, p2Days: 90, segments: ["active", "inactive"], filters: { ...EMPTY_FILTERS, valueTiers: ["high", "premium"] } } },
};

/** The Smart Persona whose benchmarks best approximate a custom audience (for budgets and the simulator). */
export function benchKeyFor(def: SegmentDefinition): PersonaKey {
  if (def.filters.signals.includes("cart_abandoned")) return "cart_abandoners";
  if (def.filters.signals.includes("repeat_viewer")) return "repeat_browsers";
  const primary = TARGETABLE.find((s) => def.segments.includes(s));
  if (primary === "active") return def.filters.valueTiers.length > 0 && def.filters.valueTiers.every((t) => t === "high" || t === "premium") ? "high_value" : "recent_buyers";
  if (primary === "inactive") return "lapsed_buyers";
  return "repeat_browsers"; // potential: knows the group, not this brand yet
}

// ---------- Pure rule evaluation (mirrors the SQL in segments.ts; used by tests and the generator) ----------

export interface CustomerRecord {
  customerId: string | null;
  lastOnlinePurchaseAt: Date | null;
  lastStorePurchaseAt: Date | null;
  groupLastOnlinePurchaseAt: Date | null;
  groupLastStorePurchaseAt: Date | null;
}

export function periodStarts(def: Pick<SegmentDefinition, "p1Days" | "p2Days">, now: Date): { p1Start: Date; p2Start: Date } {
  const p1Start = new Date(now.getTime() - def.p1Days * DAY);
  return { p1Start, p2Start: new Date(p1Start.getTime() - def.p2Days * DAY) };
}

const latest = (...ds: (Date | null)[]): Date | null => ds.reduce<Date | null>((a, d) => (d && (!a || d > a) ? d : a), null);

function channelDates(c: CustomerRecord, ch: PurchaseChannel) {
  const brand = ch === "online" ? c.lastOnlinePurchaseAt : ch === "store" ? c.lastStorePurchaseAt : latest(c.lastOnlinePurchaseAt, c.lastStorePurchaseAt);
  const group = ch === "online" ? c.groupLastOnlinePurchaseAt : ch === "store" ? c.groupLastStorePurchaseAt : latest(c.groupLastOnlinePurchaseAt, c.groupLastStorePurchaseAt);
  return { brand, group };
}

/** Rule 1. */
export function eligibility(c: CustomerRecord, ch: PurchaseChannel): "eligible" | "no_customer_id" | "other_channel" {
  if (!c.customerId) return "no_customer_id";
  const { brand, group } = channelDates(c, ch);
  return brand || group ? "eligible" : "other_channel";
}

/** Rule 2: ordered, first match wins, so every eligible customer lands in exactly one segment. */
export function assignLifecycle(c: CustomerRecord, def: Pick<SegmentDefinition, "channel" | "p1Days" | "p2Days">, now: Date): Lifecycle {
  const { p1Start, p2Start } = periodStarts(def, now);
  const { brand, group } = channelDates(c, def.channel);
  if (brand && brand >= p1Start) return "active";
  if (brand && brand >= p2Start) return "inactive";
  if (group && group >= p2Start) return "potential";
  return "out_of_scope";
}

/**
 * Rule 3 selection: within a stratum ordered randomly (by hash), rank `rn` (1-based) is in the
 * control group when it crosses the next whole multiple of pct%. That picks exactly ⌊n·pct/100⌋
 * per stratum, spread evenly, so every stratum has the same control share.
 */
export function isControlRank(rn: number, pct: number): boolean {
  return Math.floor((rn * pct) / 100) > Math.floor(((rn - 1) * pct) / 100);
}

/** IST calendar quarter, e.g. "2026-Q4". The control group is frozen for one quarter. */
export function quarterKey(d: Date): string {
  const ist = new Date(d.getTime() + 330 * 60_000);
  return `${ist.getUTCFullYear()}-Q${Math.floor(ist.getUTCMonth() / 3) + 1}`;
}

/** Plain-language summary of a definition, for cards and the review step. */
export function describeDefinition(def: SegmentDefinition): string[] {
  const lines = [
    `${CHANNEL_LABEL[def.channel]} customers with a valid customer ID`,
    `${def.segments.map((s) => LIFECYCLE_INFO[s].label).join(" + ")} (P1 = last ${def.p1Days} days, P2 = the ${def.p2Days} days before)`,
  ];
  for (const g of FILTER_GROUPS)
    for (const f of g.fields) {
      const v = def.filters[f.key];
      if (v.length) lines.push(`${f.label}: ${v.map(label).join(", ")}`);
    }
  return lines;
}

// ---------- API result shape ----------

export interface SegmentGroupCounts {
  matching: number; // in segment and passing filters
  target: number;
  control: number; // comparable control: same contactability exclusions as the target
  controlRaw: number; // everyone assigned to control
  doNotContact: number; // target only
  optedOut: number; // target only: channel opt-out or consent withdrawn
  unreachable: number; // target only: not matched on the ad channel
  contactable: number;
}

export interface SegmentFunnel {
  profiles: number;
  noCustomerId: number;
  otherChannel: number;
  eligible: number;
  distribution: Record<Lifecycle, number>; // all eligible customers, before narrowing
  perSegment: Record<TargetableSegment, SegmentGroupCounts>; // after narrowing
  selected: SegmentGroupCounts; // targeted segments combined
  controlPeriod: string | null;
  controlPct: number;
}

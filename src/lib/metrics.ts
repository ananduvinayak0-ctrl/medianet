import type { MetricBucket } from "@prisma/client";
import { computeLift, computeNsm, type LiftResult } from "./stats";
import { istDayKey } from "./time";

export interface Totals {
  impressions: number;
  clicks: number;
  conversions: number;
  returningConversions: number;
  revenuePaise: number;
  spendPaise: number;
  treatedConversions: number;
  holdoutConversions: number;
}

export const EMPTY_TOTALS: Totals = {
  impressions: 0,
  clicks: 0,
  conversions: 0,
  returningConversions: 0,
  revenuePaise: 0,
  spendPaise: 0,
  treatedConversions: 0,
  holdoutConversions: 0,
};

type BucketLike = Pick<MetricBucket, keyof Totals>;

export function sumBuckets(bs: BucketLike[]): Totals {
  const t = { ...EMPTY_TOTALS };
  for (const b of bs) {
    t.impressions += b.impressions;
    t.clicks += b.clicks;
    t.conversions += b.conversions;
    t.returningConversions += b.returningConversions;
    t.revenuePaise += b.revenuePaise;
    t.spendPaise += b.spendPaise;
    t.treatedConversions += b.treatedConversions;
    t.holdoutConversions += b.holdoutConversions;
  }
  return t;
}

export function addTotals(a: Totals, b: Totals): Totals {
  return sumBuckets([a, b]);
}

export interface Derived {
  ctr: number;
  cpcPaise: number;
  cvr: number;
  cpaPaise: number;
  roas: number;
  nsm: number;
}

export function derive(t: Totals): Derived {
  return {
    ctr: t.impressions > 0 ? t.clicks / t.impressions : 0,
    cpcPaise: t.clicks > 0 ? t.spendPaise / t.clicks : 0,
    cvr: t.clicks > 0 ? t.conversions / t.clicks : 0,
    cpaPaise: t.conversions > 0 ? t.spendPaise / t.conversions : 0,
    roas: t.spendPaise > 0 ? t.revenuePaise / t.spendPaise : 0,
    nsm: computeNsm(t.clicks, t.returningConversions),
  };
}

export function liftFor(t: Totals, treatedUsers: number, holdoutUsers: number): LiftResult {
  return computeLift(t.treatedConversions, treatedUsers, t.holdoutConversions, holdoutUsers);
}

export interface DailyPoint {
  day: string;
  spend: number; // rupees
  conversions: number;
  revenue: number; // rupees
  clicks: number;
}

export function dailySeries(bs: (BucketLike & { bucketStart: Date })[], days: string[]): DailyPoint[] {
  const map = new Map<string, DailyPoint>(days.map((d) => [d, { day: d, spend: 0, conversions: 0, revenue: 0, clicks: 0 }]));
  for (const b of bs) {
    const p = map.get(istDayKey(b.bucketStart));
    if (!p) continue;
    p.spend += b.spendPaise / 100;
    p.conversions += b.conversions;
    p.revenue += b.revenuePaise / 100;
    p.clicks += b.clicks;
  }
  return [...map.values()];
}

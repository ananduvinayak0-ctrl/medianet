import type { PersonaKey } from "./domain";

// Category × persona benchmarks used for cold-start suggestions and by the mock channel.
// In production these are aggregated across brands with a k ≥ 10 brands-per-bucket floor
// so no single brand's numbers can be inferred.

export interface Benchmark {
  ctr: number; // clicks / impressions
  cpcPaise: number; // cost per click
  cvr: number; // attributed conversions / clicks
  organicDailyRate: number; // daily purchase probability with no ads (drives holdout)
  incrementality: number; // share of attributed conversions that are truly incremental
  returningShare: number; // share of conversions from returning customers
}

type BenchTable = Record<PersonaKey, Benchmark>;

const FOOD_BEVERAGE: BenchTable = {
  cart_abandoners: { ctr: 0.012, cpcPaise: 900, cvr: 0.06, organicDailyRate: 0.004, incrementality: 0.35, returningShare: 0.45 },
  repeat_browsers: { ctr: 0.008, cpcPaise: 700, cvr: 0.025, organicDailyRate: 0.0015, incrementality: 0.45, returningShare: 0.25 },
  recent_buyers: { ctr: 0.006, cpcPaise: 650, cvr: 0.03, organicDailyRate: 0.002, incrementality: 0.3, returningShare: 1 },
  lapsed_buyers: { ctr: 0.0055, cpcPaise: 600, cvr: 0.022, organicDailyRate: 0.0008, incrementality: 0.55, returningShare: 1 },
  high_value: { ctr: 0.009, cpcPaise: 800, cvr: 0.05, organicDailyRate: 0.003, incrementality: 0.4, returningShare: 1 },
};

function scale(t: BenchTable, cpc: number, cvr: number): BenchTable {
  const out = {} as BenchTable;
  for (const k of Object.keys(t) as PersonaKey[]) {
    out[k] = { ...t[k], cpcPaise: Math.round(t[k].cpcPaise * cpc), cvr: t[k].cvr * cvr };
  }
  return out;
}

export const BENCHMARKS: Record<string, BenchTable> = {
  food_beverage: FOOD_BEVERAGE,
  fashion: scale(FOOD_BEVERAGE, 1.25, 0.8),
  beauty: scale(FOOD_BEVERAGE, 1.15, 0.95),
};

export const CATEGORY_LABEL: Record<string, string> = {
  food_beverage: "Food & beverage",
  fashion: "Fashion & apparel",
  beauty: "Beauty & personal care",
};

export function getBenchmark(category: string, persona: PersonaKey): Benchmark {
  return (BENCHMARKS[category] ?? FOOD_BEVERAGE)[persona];
}

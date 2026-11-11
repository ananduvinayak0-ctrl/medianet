import type { Benchmark } from "../benchmarks";
import { peakForDay } from "../calendar";
import { seededRng } from "../rng";
import { istDayKey, istHour, istHourStart, MINUTE } from "../time";

// Mock-channel delivery simulator (pure, deterministic). Stands in for the ad server:
// paces spend through the IST day, enforces daily budget / lifetime cap / wallet pool /
// frequency cap channel-side, models ad fatigue, and generates holdout vs treated outcomes.

// Relative traffic by IST hour (mean = 1): quiet nights, evening peak.
export const DIURNAL = [
  0.35, 0.25, 0.2, 0.18, 0.2, 0.3, 0.5, 0.75, 0.95, 1.05, 1.1, 1.15, 1.2, 1.2, 1.15, 1.1, 1.15, 1.25, 1.45, 1.65, 1.75, 1.7, 1.35, 0.82,
];

export interface SimCampaign {
  id: string;
  dailyBudgetPaise: number;
  lifetimeBudgetPaise: number;
  startAt: Date;
  endAt: Date;
  freqCapDay: number;
  treatedUsers: number;
  holdoutUsers: number;
  bench: Benchmark;
  aovPaise: number;
  totalSpendPaise: number;
}

export interface DayStat {
  spendPaise: number;
  impressions: number;
}

export interface BucketDelta {
  bucketStart: Date;
  impressions: number;
  clicks: number;
  conversions: number;
  returningConversions: number;
  revenuePaise: number;
  spendPaise: number;
  treatedConversions: number;
  holdoutConversions: number;
}

export interface SimResult {
  deltas: BucketDelta[];
  spentPaise: number;
  ended: boolean;
  reachedLifetimeCap: boolean;
  walletExhausted: boolean;
}

export const STEP_MINUTES = 15;

/**
 * Simulate delivery over [from, to). `dayStats` (keyed by IST day) is read and mutated so
 * callers can chain calls. `walletAvailablePaise` is the channel-side cap mirrored from the
 * wallet: delivery stops before overshooting it.
 */
export function simulateDelivery(
  c: SimCampaign,
  from: Date,
  to: Date,
  dayStats: Record<string, DayStat>,
  walletAvailablePaise: number,
): SimResult {
  const buckets = new Map<number, BucketDelta>();
  let total = c.totalSpendPaise;
  let spent = 0;
  let reachedLifetimeCap = false;
  let walletExhausted = false;

  let t = Math.max(from.getTime(), c.startAt.getTime());
  const stop = Math.min(to.getTime(), c.endAt.getTime());

  while (t < stop) {
    const tEnd = Math.min(t + STEP_MINUTES * MINUTE, stop);
    const mins = (tEnd - t) / MINUTE;
    const at = new Date(t);
    const dayKey = istDayKey(at);
    const ds = (dayStats[dayKey] ??= { spendPaise: 0, impressions: 0 });

    const remainingLifetime = c.lifetimeBudgetPaise - total;
    if (remainingLifetime <= 0.5) {
      reachedLifetimeCap = true;
      break;
    }
    const remainingWallet = walletAvailablePaise - spent;
    if (remainingWallet <= 0.5) {
      walletExhausted = true;
      break;
    }

    const rng = seededRng(c.id, t);
    const peak = peakForDay(dayKey);
    const pacingTarget = (c.dailyBudgetPaise * DIURNAL[istHour(at)] * mins) / (24 * 60);
    let spend = Math.min(pacingTarget, c.dailyBudgetPaise - ds.spendPaise, remainingLifetime, remainingWallet);

    // Outcomes accrue for treated & holdout groups regardless of ad delivery.
    const organicT = (c.treatedUsers * c.bench.organicDailyRate * mins) / 1440;
    const organicH = ((c.holdoutUsers * c.bench.organicDailyRate * mins) / 1440) * (0.85 + 0.3 * rng());

    let impressions = 0;
    let clicks = 0;
    let conversions = 0;
    let revenue = 0;

    if (spend > 0) {
      const cpc = c.bench.cpcPaise * (peak?.cpcFactor ?? 1) * (0.85 + 0.3 * rng());
      const freqToday = ds.impressions / Math.max(1, c.treatedUsers);
      const fatigue = 1 / (1 + Math.max(0, freqToday - 1.5) * 0.25);
      const ctr = c.bench.ctr * fatigue * (0.9 + 0.2 * rng());
      clicks = spend / cpc;
      impressions = clicks / ctr;
      // Frequency cap (channel-side): at most treatedUsers × cap impressions per day.
      const remainingImps = Math.max(0, c.treatedUsers * c.freqCapDay - ds.impressions);
      if (impressions > remainingImps) {
        const k = remainingImps / impressions;
        impressions *= k;
        clicks *= k;
        spend *= k;
      }
      const cvr = c.bench.cvr * (peak?.cvrFactor ?? 1) * (0.75 + 0.5 * rng());
      conversions = clicks * cvr;
      revenue = conversions * c.aovPaise * (0.85 + 0.3 * rng());
    } else {
      spend = 0;
    }

    const key = istHourStart(at).getTime();
    const b =
      buckets.get(key) ??
      ({
        bucketStart: new Date(key),
        impressions: 0,
        clicks: 0,
        conversions: 0,
        returningConversions: 0,
        revenuePaise: 0,
        spendPaise: 0,
        treatedConversions: 0,
        holdoutConversions: 0,
      } satisfies BucketDelta);
    b.impressions += impressions;
    b.clicks += clicks;
    b.conversions += conversions;
    b.returningConversions += conversions * c.bench.returningShare;
    b.revenuePaise += revenue;
    b.spendPaise += spend;
    b.treatedConversions += organicT + conversions * c.bench.incrementality;
    b.holdoutConversions += organicH;
    buckets.set(key, b);

    ds.spendPaise += spend;
    ds.impressions += impressions;
    total += spend;
    spent += spend;
    t = tEnd;
  }

  if (!reachedLifetimeCap && c.lifetimeBudgetPaise - total <= 0.5) reachedLifetimeCap = true;

  return {
    deltas: [...buckets.values()],
    spentPaise: spent,
    ended: to.getTime() >= c.endAt.getTime(),
    reachedLifetimeCap,
    walletExhausted,
  };
}

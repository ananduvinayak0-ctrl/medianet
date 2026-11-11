import type { Benchmark } from "../benchmarks";
import { formatINR, formatNum, formatPct } from "../format";

// Budget Suggester v1: transparent rules + statistics, NOT a black-box model.
// Suggest-only: nothing changes until a human accepts. Every output carries the inputs it
// used, the guardrails that bound it, and plain-language reasons.

export interface PastCampaign {
  personaKey: string;
  days: number;
  spendPaise: number;
  clicks: number;
  conversions: number;
  revenuePaise: number;
}

export interface BudgetSuggesterInput {
  personaKey: string;
  personaName: string;
  bench: Benchmark;
  treatedUsers: number;
  freqCapDay: number;
  durationDays: number;
  aovPaise: number;
  walletAvailablePaise: number;
  history: PastCampaign[];
  peak?: { name: string; cpcFactor: number; cvrFactor: number } | null;
}

export type Confidence = "high" | "medium" | "low";

export interface Guardrail {
  label: string;
  limitPaise: number | null;
  binding: boolean;
  detail: string;
}

export interface BudgetSuggestion {
  status: "ok" | "insufficient_data";
  confidence: Confidence;
  recommendedDailyPaise: number;
  recommendedLifetimePaise: number;
  expected: {
    clicks: number;
    conversions: [number, number, number]; // low, expected, high
    roas: [number, number, number];
    cpaPaise: number;
  };
  reasons: string[];
  guardrails: Guardrail[];
  inputsUsed: { label: string; value: string }[];
}

export const MIN_DAILY_PAISE = 500 * 100; // ₹500/day platform minimum
const SATURATION_HEADROOM = 0.8; // don't buy the last 20% of possible impressions: mostly repeats
const OWN_DATA_MIN_CLICKS = 200;
const SPREAD: Record<Confidence, number> = { high: 0.15, medium: 0.3, low: 0.5 };

export function suggestBudget(input: BudgetSuggesterInput): BudgetSuggestion {
  const days = Math.max(1, Math.round(input.durationDays));
  const own = input.history.filter((h) => h.personaKey === input.personaKey);
  const ownClicks = sum(own.map((h) => h.clicks));
  const ownConv = sum(own.map((h) => h.conversions));
  const ownSpend = sum(own.map((h) => h.spendPaise));
  const useOwn = ownClicks >= OWN_DATA_MIN_CLICKS;

  // 1. Blend the brand's own history with category benchmarks (70/30) once there's enough data.
  let cpc = input.bench.cpcPaise;
  let cvr = input.bench.cvr;
  if (useOwn) {
    cpc = 0.7 * (ownSpend / ownClicks) + 0.3 * cpc;
    cvr = 0.7 * (ownConv / ownClicks) + 0.3 * cvr;
  }
  if (input.peak) {
    cpc *= input.peak.cpcFactor;
    cvr *= input.peak.cvrFactor;
  }

  // 2. Candidate limits: whichever is lowest wins.
  const saturation = input.treatedUsers * input.freqCapDay * input.bench.ctr * cpc * SATURATION_HEADROOM;
  const pastMaxDaily = Math.max(0, ...input.history.map((h) => (h.days > 0 ? h.spendPaise / h.days : 0)));
  const historyCap = pastMaxDaily > 0 ? 2 * pastMaxDaily : Number.POSITIVE_INFINITY;
  const walletCap = input.walletAvailablePaise / days;

  const raw = Math.min(saturation, historyCap, walletCap);
  let daily = Math.floor(raw / 10_000) * 10_000; // round down to ₹100
  if (daily < MIN_DAILY_PAISE) daily = walletCap >= MIN_DAILY_PAISE ? MIN_DAILY_PAISE : Math.floor(walletCap / 100) * 100;

  const binding = raw === walletCap ? "wallet" : raw === historyCap ? "history" : "saturation";

  // 3. Confidence: more of the brand's own data means more trust.
  const confidence: Confidence =
    own.length >= 2 && ownConv >= 50 ? "high" : input.history.length >= 1 ? "medium" : "low";

  // 4. Expected outcomes with a range proportional to uncertainty.
  const lifetime = daily * days;
  const clicks = lifetime / cpc;
  const conv = clicks * cvr;
  const s = SPREAD[confidence];
  const revenue = conv * input.aovPaise;
  const roas = lifetime > 0 ? revenue / lifetime : 0;

  const reasons: string[] = [];
  if (binding === "saturation") {
    reasons.push(
      `${formatNum(input.treatedUsers)} people in "${input.personaName}" can see ads (holdout excluded). At ${input.freqCapDay} ads/person/day they can usefully absorb about ${formatINR(saturation)}/day. Spending more would mostly repeat ads to the same people.`,
    );
  } else if (binding === "history") {
    reasons.push(
      `Capped at 2× your highest past daily spend (${formatINR(pastMaxDaily)}/day), so a new campaign never jumps far beyond what you've tested before.`,
    );
  } else {
    reasons.push(`Limited by your wallet: ${formatINR(input.walletAvailablePaise)} available across ${days} days. Top up to unlock more.`);
  }
  if (useOwn) {
    reasons.push(
      `Based on your ${own.length} past "${input.personaName}" campaign${own.length > 1 ? "s" : ""}: ${formatPct(ownConv / ownClicks)} of clicks converted at ${formatINR(ownSpend / ownClicks, { precise: true })} per click.`,
    );
  } else {
    reasons.push(
      `You don't have enough past results for this audience yet, so we used category benchmarks (${formatPct(input.bench.cvr)} conversion rate at ${formatINR(input.bench.cpcPaise, { precise: true })} per click).`,
    );
  }
  if (input.peak) {
    reasons.push(
      `${input.peak.name} overlaps your dates. Clicks typically cost ~${Math.round((input.peak.cpcFactor - 1) * 100)}% more but convert ~${Math.round((input.peak.cvrFactor - 1) * 100)}% better.`,
    );
  }

  const guardrails: Guardrail[] = [
    { label: "Wallet balance", limitPaise: walletCap, binding: binding === "wallet", detail: "Never suggest more than your wallet can fund for the full schedule." },
    {
      label: "2× past maximum",
      limitPaise: Number.isFinite(historyCap) ? historyCap : null,
      binding: binding === "history",
      detail: Number.isFinite(historyCap) ? "Never more than double your highest past daily spend." : "No past campaigns yet, so this limit doesn't apply.",
    },
    { label: "Audience saturation", limitPaise: saturation, binding: binding === "saturation", detail: "Stop before the audience is saturated at your frequency cap." },
    { label: "Platform minimum", limitPaise: MIN_DAILY_PAISE, binding: false, detail: "₹500/day minimum so the campaign can learn." },
  ];

  return {
    status: confidence === "low" ? "insufficient_data" : "ok",
    confidence,
    recommendedDailyPaise: daily,
    recommendedLifetimePaise: lifetime,
    expected: {
      clicks,
      conversions: [conv * (1 - s), conv, conv * (1 + s)],
      roas: [roas * (1 - s), roas, roas * (1 + s)],
      cpaPaise: conv > 0 ? lifetime / conv : 0,
    },
    reasons: reasons.slice(0, 3),
    guardrails,
    inputsUsed: [
      { label: "Reachable audience (excl. holdout)", value: formatNum(input.treatedUsers) },
      { label: "Frequency cap", value: `${input.freqCapDay}/day` },
      { label: "Duration", value: `${days} days` },
      { label: "Cost per click used", value: formatINR(cpc, { precise: true }) },
      { label: "Conversion rate used", value: formatPct(cvr) },
      { label: "Average order value", value: formatINR(input.aovPaise) },
      { label: "Past campaigns considered", value: String(input.history.length) },
    ],
  };
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

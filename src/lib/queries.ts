import type { Campaign } from "@prisma/client";
import { db } from "./db";
import { EMPTY_TOTALS, type Totals } from "./metrics";

// Read-side helpers for list/summary views.

export async function campaignTotalsMap(campaignIds: string[]): Promise<Map<string, Totals>> {
  const rows = await db.metricBucket.groupBy({
    by: ["campaignId"],
    where: { campaignId: { in: campaignIds } },
    _sum: { impressions: true, clicks: true, conversions: true, returningConversions: true, revenuePaise: true, spendPaise: true, treatedConversions: true, holdoutConversions: true },
  });
  const map = new Map<string, Totals>();
  for (const r of rows) {
    map.set(r.campaignId, {
      impressions: r._sum.impressions ?? 0,
      clicks: r._sum.clicks ?? 0,
      conversions: r._sum.conversions ?? 0,
      returningConversions: r._sum.returningConversions ?? 0,
      revenuePaise: r._sum.revenuePaise ?? 0,
      spendPaise: r._sum.spendPaise ?? 0,
      treatedConversions: r._sum.treatedConversions ?? 0,
      holdoutConversions: r._sum.holdoutConversions ?? 0,
    });
  }
  for (const id of campaignIds) if (!map.has(id)) map.set(id, { ...EMPTY_TOTALS });
  return map;
}

/** Pooled holdout comparison across campaigns (users can overlap across campaigns, so this is an approximation). */
export function pooledLiftInputs(campaigns: Campaign[], totals: Map<string, Totals>) {
  let tc = 0,
    tn = 0,
    hc = 0,
    hn = 0;
  for (const c of campaigns) {
    const t = totals.get(c.id);
    if (!t || t.spendPaise === 0) continue;
    tc += t.treatedConversions;
    tn += c.treatedUsers;
    hc += t.holdoutConversions;
    hn += c.holdoutUsers;
  }
  return { tc, tn, hc, hn };
}

import type { Prisma, PrismaClient } from "@prisma/client";
import type { Objective, PersonaKey } from "./domain";
import { DAY } from "./time";

// Smart Personas (MVP): five transparent, rule-based retention segments.
// Every definition is shown to the user in plain language — no black boxes.

export interface PersonaDef {
  key: PersonaKey;
  name: string;
  objective: Objective;
  definition: string; // plain-language rule shown in the UI
  why: string; // why this segment is worth targeting
  excludesRecentBuyers: boolean;
}

export const PERSONAS: PersonaDef[] = [
  {
    key: "cart_abandoners",
    name: "Cart abandoners",
    objective: "retarget",
    definition: "Added something to cart in the last 7 days and haven't bought since.",
    why: "Highest purchase intent of any segment. Usually the cheapest conversions you can buy.",
    excludesRecentBuyers: true,
  },
  {
    key: "repeat_browsers",
    name: "Repeat product viewers",
    objective: "retarget",
    definition: "Viewed products 2+ times in the last 14 days, no cart in the last 7 days.",
    why: "Interested but undecided. A reminder (or the exact product) often tips them over.",
    excludesRecentBuyers: true,
  },
  {
    key: "recent_buyers",
    name: "Recent buyers (cross-sell)",
    objective: "reactivate",
    definition: "Bought in the last 30 days.",
    why: "Happy customers are the easiest second purchase. Best for complementary products, not the same item.",
    excludesRecentBuyers: false,
  },
  {
    key: "lapsed_buyers",
    name: "Lapsed buyers",
    objective: "reactivate",
    definition: "Last purchase was 31–90 days ago.",
    why: "They know your brand but are drifting away. This is where incremental lift is usually highest.",
    excludesRecentBuyers: false,
  },
  {
    key: "high_value",
    name: "High-value customers",
    objective: "reactivate",
    definition: "Top 20% of customers by lifetime spend, with a purchase in the last 180 days.",
    why: "Your best customers. Ideal for early access and launches. Keep frequency low.",
    excludesRecentBuyers: false,
  },
];

export function getPersona(key: string): PersonaDef {
  const p = PERSONAS.find((x) => x.key === key);
  if (!p) throw new Error(`Unknown persona ${key}`);
  return p;
}

const since = (now: Date, days: number) => new Date(now.getTime() - days * DAY);

export function personaWhere(key: PersonaKey, now: Date, highValueThresholdPaise = 0): Prisma.ProfileWhereInput {
  switch (key) {
    case "cart_abandoners":
      return { cartPendingAt: { gte: since(now, 7) } };
    case "repeat_browsers":
      return {
        lastViewAt: { gte: since(now, 14) },
        viewCount14d: { gte: 2 },
        OR: [{ cartPendingAt: null }, { cartPendingAt: { lt: since(now, 7) } }],
      };
    case "recent_buyers":
      return { lastPurchaseAt: { gte: since(now, 30) } };
    case "lapsed_buyers":
      return { lastPurchaseAt: { gte: since(now, 90), lt: since(now, 30) } };
    case "high_value":
      return { lastPurchaseAt: { gte: since(now, 180) }, totalSpendPaise: { gte: highValueThresholdPaise } };
  }
}

export async function highValueThreshold(db: PrismaClient, workspaceId: string, now: Date): Promise<number> {
  const where = { workspaceId, lastPurchaseAt: { gte: since(now, 180) } };
  const n = await db.profile.count({ where });
  if (n === 0) return Number.MAX_SAFE_INTEGER;
  const row = await db.profile.findFirst({
    where,
    orderBy: { totalSpendPaise: "desc" },
    skip: Math.max(0, Math.floor(n * 0.2) - 1),
    select: { totalSpendPaise: true },
  });
  return row?.totalSpendPaise ?? Number.MAX_SAFE_INTEGER;
}

export interface AudienceStats {
  key: PersonaKey;
  total: number; // everyone matching the rule
  consentWithdrawn: number; // excluded: consent withdrawn (DPDP)
  recentBuyersExcluded: number; // excluded: bought in last 30 days
  unmatched: number; // not reachable on the channel
  eligible: number; // reachable + consented + not excluded
  holdout: number; // kept out of ads to measure true lift
  treated: number; // will actually see ads
}

export async function audienceStats(
  db: PrismaClient,
  ws: { id: string; holdoutPct: number },
  key: PersonaKey,
  now: Date,
): Promise<AudienceStats> {
  const def = getPersona(key);
  const threshold = key === "high_value" ? await highValueThreshold(db, ws.id, now) : 0;
  const base: Prisma.ProfileWhereInput = { workspaceId: ws.id, ...personaWhere(key, now, threshold) };
  const recentBuyer: Prisma.ProfileWhereInput = { lastPurchaseAt: { gte: since(now, 30) } };
  const notExcluded: Prisma.ProfileWhereInput[] = def.excludesRecentBuyers ? [{ NOT: recentBuyer }] : [];

  const [total, consentWithdrawn, recentBuyersExcluded, unmatched, eligible, holdout] = await Promise.all([
    db.profile.count({ where: base }),
    db.profile.count({ where: { AND: [base, { consent: "withdrawn" }] } }),
    def.excludesRecentBuyers
      ? db.profile.count({ where: { AND: [base, { consent: "granted" }, recentBuyer] } })
      : Promise.resolve(0),
    db.profile.count({ where: { AND: [base, { consent: "granted", matched: false }, ...notExcluded] } }),
    db.profile.count({ where: { AND: [base, { consent: "granted", matched: true }, ...notExcluded] } }),
    db.profile.count({
      where: { AND: [base, { consent: "granted", matched: true, holdoutBucket: { lt: ws.holdoutPct } }, ...notExcluded] },
    }),
  ]);

  return {
    key,
    total,
    consentWithdrawn,
    recentBuyersExcluded,
    unmatched,
    eligible,
    holdout,
    treated: eligible - holdout,
  };
}

export async function allAudienceStats(
  db: PrismaClient,
  ws: { id: string; holdoutPct: number },
  now: Date,
): Promise<Record<PersonaKey, AudienceStats>> {
  const entries = await Promise.all(PERSONAS.map(async (p) => [p.key, await audienceStats(db, ws, p.key, now)] as const));
  return Object.fromEntries(entries) as Record<PersonaKey, AudienceStats>;
}

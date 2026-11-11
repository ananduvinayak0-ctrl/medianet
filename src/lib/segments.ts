import { Prisma, type PrismaClient, type Workspace } from "@prisma/client";
import type { AudienceStats } from "./personas";
import {
  benchKeyFor,
  LIFECYCLE,
  periodStarts,
  TARGETABLE,
  type Lifecycle,
  type PurchaseChannel,
  type SegmentDefinition,
  type SegmentFilters,
  type SegmentFunnel,
  type SegmentGroupCounts,
  type TargetableSegment,
} from "./segment-defs";

// Custom audience engine: evaluates Rules 1–5 for a definition in ONE grouped SQL query over
// the brand's profiles, so the builder can preview live. All values are bind parameters.

const DAY = 86_400_000;

function channelCols(ch: PurchaseChannel) {
  const brand =
    ch === "online" ? Prisma.sql`"lastOnlinePurchaseAt"` : ch === "store" ? Prisma.sql`"lastStorePurchaseAt"` : Prisma.sql`GREATEST("lastOnlinePurchaseAt", "lastStorePurchaseAt")`;
  const group =
    ch === "online"
      ? Prisma.sql`"groupLastOnlinePurchaseAt"`
      : ch === "store"
        ? Prisma.sql`"groupLastStorePurchaseAt"`
        : Prisma.sql`GREATEST("groupLastOnlinePurchaseAt", "groupLastStorePurchaseAt")`;
  return { brand, group };
}

const COLUMN: Partial<Record<keyof SegmentFilters, string>> = {
  valueTiers: "valueTier",
  lifeStages: "lifeStage",
  ageBands: "ageBand",
  incomeBands: "incomeBand",
  nationalities: "nationality",
  languages: "language",
  loyaltyTiers: "loyaltyTier",
  regions: "region",
  stores: "homeStore",
};

/** Rule 5 as SQL. Within a field, values are OR'd; across fields, AND'd. */
export function filterSql(f: SegmentFilters, now: Date): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  for (const [key, col] of Object.entries(COLUMN) as [keyof SegmentFilters, string][]) {
    const vals = f[key];
    if (vals.length) parts.push(Prisma.sql`${Prisma.raw(`"${col}"`)} IN (${Prisma.join(vals)})`);
  }
  if (f.promo.length) {
    const ranges = f.promo.map((p) =>
      p === "full_price" ? Prisma.sql`"fullPriceShare" >= 0.8` : p === "mixed" ? Prisma.sql`("fullPriceShare" >= 0.4 AND "fullPriceShare" < 0.8)` : Prisma.sql`"fullPriceShare" < 0.4`,
    );
    parts.push(Prisma.sql`(${Prisma.join(ranges, " OR ")})`);
  }
  if (f.categories.length) parts.push(Prisma.sql`"categories" && ARRAY[${Prisma.join(f.categories)}]::text[]`);
  if (f.signals.length) {
    const sig = f.signals.map((s) =>
      s === "cart_abandoned"
        ? Prisma.sql`"cartPendingAt" >= ${new Date(now.getTime() - 7 * DAY)}`
        : Prisma.sql`("lastViewAt" >= ${new Date(now.getTime() - 14 * DAY)} AND "viewCount14d" >= 2)`,
    );
    parts.push(Prisma.sql`(${Prisma.join(sig, " OR ")})`);
  }
  return parts.length ? Prisma.join(parts, " AND ") : Prisma.sql`TRUE`;
}

const emptyGroup = (): SegmentGroupCounts => ({ matching: 0, target: 0, control: 0, controlRaw: 0, doNotContact: 0, optedOut: 0, unreachable: 0, contactable: 0 });

function addGroup(a: SegmentGroupCounts, b: SegmentGroupCounts): SegmentGroupCounts {
  const out = emptyGroup();
  for (const k of Object.keys(out) as (keyof SegmentGroupCounts)[]) out[k] = a[k] + b[k];
  return out;
}

interface Row {
  seg: string;
  pass: boolean;
  control: boolean;
  dnc: boolean;
  optout: boolean;
  matched: boolean;
  n: number;
}

export async function segmentFunnel(db: PrismaClient, ws: Pick<Workspace, "id" | "holdoutPct" | "controlPeriodKey">, def: SegmentDefinition, now: Date): Promise<SegmentFunnel> {
  const { p1Start, p2Start } = periodStarts(def, now);
  const { brand, group } = channelCols(def.channel);
  const rows = await db.$queryRaw<Row[]>`
    SELECT seg, pass, control, dnc, optout, matched, count(*)::int AS n FROM (
      SELECT
        CASE
          WHEN "customerId" IS NULL THEN 'no_customer_id'
          WHEN ${brand} IS NULL AND ${group} IS NULL THEN 'other_channel'
          WHEN ${brand} >= ${p1Start} THEN 'active'
          WHEN ${brand} >= ${p2Start} THEN 'inactive'
          WHEN ${group} >= ${p2Start} THEN 'potential'
          ELSE 'out_of_scope'
        END AS seg,
        (${filterSql(def.filters, now)}) AS pass,
        "controlGroup" AS control,
        "doNotContact" AS dnc,
        ("adsOptOut" OR consent <> 'granted') AS optout,
        matched
      FROM "Profile"
      WHERE "workspaceId" = ${ws.id}
    ) t
    GROUP BY 1, 2, 3, 4, 5, 6`;
  return aggregateFunnel(rows, def, ws);
}

/** Pure aggregation of the grouped rows (exported for tests). */
export function aggregateFunnel(rows: Row[], def: Pick<SegmentDefinition, "segments">, ws: Pick<Workspace, "holdoutPct" | "controlPeriodKey">): SegmentFunnel {
  const f: SegmentFunnel = {
    profiles: 0,
    noCustomerId: 0,
    otherChannel: 0,
    eligible: 0,
    distribution: Object.fromEntries(LIFECYCLE.map((s) => [s, 0])) as Record<Lifecycle, number>,
    perSegment: Object.fromEntries(TARGETABLE.map((s) => [s, emptyGroup()])) as Record<TargetableSegment, SegmentGroupCounts>,
    selected: emptyGroup(),
    controlPeriod: ws.controlPeriodKey,
    controlPct: ws.holdoutPct,
  };
  for (const r of rows) {
    f.profiles += r.n;
    if (r.seg === "no_customer_id") {
      f.noCustomerId += r.n;
      continue;
    }
    if (r.seg === "other_channel") {
      f.otherChannel += r.n;
      continue;
    }
    f.eligible += r.n;
    f.distribution[r.seg as Lifecycle] += r.n;
    if (!(TARGETABLE as readonly string[]).includes(r.seg) || !r.pass) continue;
    const g = f.perSegment[r.seg as TargetableSegment];
    g.matching += r.n;
    const reachable = !r.dnc && !r.optout && r.matched;
    if (r.control) {
      g.controlRaw += r.n;
      if (reachable) g.control += r.n; // like-for-like with the contactable target
      continue;
    }
    // Rule 4: only the target group is contacted; exclusions in this order.
    g.target += r.n;
    if (r.dnc) g.doNotContact += r.n;
    else if (r.optout) g.optedOut += r.n;
    else if (!r.matched) g.unreachable += r.n;
    else g.contactable += r.n;
  }
  for (const s of def.segments) f.selected = addGroup(f.selected, f.perSegment[s]);
  return f;
}

/** Campaign-facing numbers for a custom audience, in the same shape as Smart Personas. */
export function statsFromFunnel(f: SegmentFunnel, def: SegmentDefinition): AudienceStats {
  const s = f.selected;
  return {
    key: benchKeyFor(def),
    total: s.matching,
    consentWithdrawn: s.optedOut,
    doNotContact: s.doNotContact,
    recentBuyersExcluded: 0,
    unmatched: s.unreachable,
    eligible: s.contactable + s.control,
    holdout: s.control,
    treated: s.contactable,
  };
}

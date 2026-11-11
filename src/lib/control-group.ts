import type { PrismaClient, Workspace } from "@prisma/client";
import { audit, SYSTEM } from "./audit";
import { quarterKey } from "./segment-defs";

// Rule 3: Target and Control groups.
//
// One brand-level control group per IST quarter, used by every audience (custom and Smart
// Personas), so a customer is never contacted by one campaign while being control for another.
// The split is stratified: customers are grouped by lifecycle segment (default P1 = 90 days,
// P2 = the 270 days before) × value tier × purchase channel, put in a random order (a hash of
// their ID, the brand salt and the quarter), and exactly holdoutPct% of each stratum is taken
// as control. Every stratum, and so every segment, gets the same control share and a similar mix.
// The assignment stays fixed until the quarter changes.

const DAY = 86_400_000;

export async function refreshControlGroup(db: PrismaClient, ws: Pick<Workspace, "id" | "holdoutPct" | "holdoutSalt">, now: Date, periodKey = quarterKey(now)): Promise<number> {
  const p1 = new Date(now.getTime() - 90 * DAY);
  const p2 = new Date(p1.getTime() - 270 * DAY);
  return db.$executeRaw`
    WITH strata AS (
      SELECT id,
        (CASE
          WHEN GREATEST("lastOnlinePurchaseAt", "lastStorePurchaseAt") >= ${p1} THEN 'active'
          WHEN GREATEST("lastOnlinePurchaseAt", "lastStorePurchaseAt") >= ${p2} THEN 'inactive'
          WHEN GREATEST("groupLastOnlinePurchaseAt", "groupLastStorePurchaseAt") >= ${p2} THEN 'potential'
          ELSE 'other' END)
        || '|' || "valueTier"
        || '|' || (CASE
          WHEN "lastOnlinePurchaseAt" IS NOT NULL AND "lastStorePurchaseAt" IS NOT NULL THEN 'both'
          WHEN "lastStorePurchaseAt" IS NOT NULL OR "groupLastStorePurchaseAt" IS NOT NULL THEN 'store'
          ELSE 'online' END) AS stratum,
        md5("idHash" || ${ws.holdoutSalt} || ${periodKey}) AS h
      FROM "Profile"
      WHERE "workspaceId" = ${ws.id}
    ),
    ranked AS (
      SELECT id, row_number() OVER (PARTITION BY stratum ORDER BY h) AS rn FROM strata
    )
    UPDATE "Profile" p
    SET "controlGroup" = (floor(r.rn * ${ws.holdoutPct}::numeric / 100) > floor((r.rn - 1) * ${ws.holdoutPct}::numeric / 100))
    FROM ranked r
    WHERE p.id = r.id`;
}

/** Make sure this quarter's control group exists. Cheap no-op except at a quarter boundary. */
export async function ensureControlGroup(db: PrismaClient, ws: Workspace, now: Date): Promise<void> {
  const key = quarterKey(now);
  if (ws.controlPeriodKey === key) return;
  // Claim the refresh so concurrent requests don't all run it.
  const claimed = await db.workspace.updateMany({
    where: { id: ws.id, OR: [{ controlPeriodKey: null }, { controlPeriodKey: { not: key } }] },
    data: { controlPeriodKey: key, controlRefreshedAt: now },
  });
  if (claimed.count === 0) return;
  try {
    const n = await refreshControlGroup(db, ws, now, key);
    await audit(db, {
      workspaceId: ws.id,
      actor: SYSTEM,
      action: "control_group.refreshed",
      entityType: "workspace",
      entityId: ws.id,
      summary: `Control group for ${key}: ${ws.holdoutPct}% of ${n.toLocaleString("en-IN")} customers, stratified by lifecycle × value tier × channel. Fixed until the quarter ends.`,
      at: now,
    });
  } catch (e) {
    await db.workspace.update({ where: { id: ws.id }, data: { controlPeriodKey: ws.controlPeriodKey } }); // let the next request retry
    throw e;
  }
}

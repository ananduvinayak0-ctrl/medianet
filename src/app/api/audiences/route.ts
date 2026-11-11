import { route } from "@/lib/api";
import { db } from "@/lib/db";
import { allAudienceStats } from "@/lib/personas";
import { getSession } from "@/lib/session";

/** GET /api/audiences → audience sizes for every Smart Persona (holdout + exclusions applied). */
export const GET = route(async () => {
  const s = await getSession();
  return allAudienceStats(db, s.workspace, s.simNow);
});

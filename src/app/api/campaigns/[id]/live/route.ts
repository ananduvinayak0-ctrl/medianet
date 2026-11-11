import { route } from "@/lib/api";
import { getMonitor } from "@/lib/monitor";
import { getSession } from "@/lib/session";

/** GET /api/campaigns/:id/live — advances the demo clock and returns Live Monitor data. */
export const GET = route<{ id: string }>(async (_req, { params }) => {
  const { id } = await params;
  return getMonitor(await getSession(), id);
});

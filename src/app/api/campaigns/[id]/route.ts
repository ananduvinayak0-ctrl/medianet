import { route, readJson } from "@/lib/api";
import { saveCampaign } from "@/lib/campaign-service";
import { getSession } from "@/lib/session";

/** PUT /api/campaigns/:id  { campaign, launch } — edit a draft (and optionally launch it). */
export const PUT = route<{ id: string }>(async (req, { params }) => {
  const { id } = await params;
  const session = await getSession();
  const body = (await readJson(req)) as { campaign?: unknown; launch?: boolean };
  return saveCampaign(session, body.campaign, { id, launch: Boolean(body.launch) });
});

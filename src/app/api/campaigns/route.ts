import { route, readJson } from "@/lib/api";
import { saveCampaign } from "@/lib/campaign-service";
import { getSession } from "@/lib/session";

/** POST /api/campaigns  { campaign: CampaignInput, launch: boolean } → Campaign */
export const POST = route(async (req) => {
  const session = await getSession();
  const body = (await readJson(req)) as { campaign?: unknown; launch?: boolean };
  return saveCampaign(session, body.campaign, { launch: Boolean(body.launch) });
});

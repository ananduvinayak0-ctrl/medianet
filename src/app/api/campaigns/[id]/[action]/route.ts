import { route, readJson } from "@/lib/api";
import { approveCampaign, changeBudget, cloneCampaign, launchDraft, pauseCampaign, resumeCampaign, stopCampaign } from "@/lib/campaign-service";
import { notFound } from "@/lib/errors";
import { getSession } from "@/lib/session";

/**
 * POST /api/campaigns/:id/{launch|approve|pause|resume|stop|clone|budget}
 * pause: { note? }   budget: { dailyBudgetRupees, lifetimeBudgetRupees, reason?, alertId? }
 */
export const POST = route<{ id: string; action: string }>(async (req, { params }) => {
  const { id, action } = await params;
  const session = await getSession();
  const body = (await readJson(req)) as Record<string, unknown>;
  switch (action) {
    case "launch":
      return launchDraft(session, id);
    case "approve":
      return approveCampaign(session, id);
    case "pause":
      return pauseCampaign(session, id, typeof body.note === "string" ? body.note.slice(0, 120) : undefined);
    case "resume":
      return resumeCampaign(session, id);
    case "stop":
      return stopCampaign(session, id);
    case "clone":
      return cloneCampaign(session, id);
    case "budget":
      return changeBudget(session, id, body);
    default:
      throw notFound(`Unknown action ${action}`);
  }
});

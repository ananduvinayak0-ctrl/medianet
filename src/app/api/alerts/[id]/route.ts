import { route, readJson } from "@/lib/api";
import { updateAlert } from "@/lib/campaign-service";
import { badRequest } from "@/lib/errors";
import { getSession } from "@/lib/session";

/** POST /api/alerts/:id { status: "dismissed" | "actioned" } */
export const POST = route<{ id: string }>(async (req, { params }) => {
  const { id } = await params;
  const { status } = (await readJson(req)) as { status?: string };
  if (status !== "dismissed" && status !== "actioned") throw badRequest("status must be dismissed or actioned");
  await updateAlert(await getSession(), id, status);
  return { ok: true };
});

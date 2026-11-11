import { route, readJson } from "@/lib/api";
import { archivePersona, updatePersona } from "@/lib/audience-service";
import { getSession } from "@/lib/session";

/** PUT /api/audiences/custom/:id { name, description, basedOn?, definition } → CustomPersona */
export const PUT = route<{ id: string }>(async (req, { params }) => {
  const { id } = await params;
  return updatePersona(await getSession(), id, await readJson(req));
});

/** DELETE /api/audiences/custom/:id → archives (campaigns that used it keep their history). */
export const DELETE = route<{ id: string }>(async (_req, { params }) => {
  const { id } = await params;
  return archivePersona(await getSession(), id);
});

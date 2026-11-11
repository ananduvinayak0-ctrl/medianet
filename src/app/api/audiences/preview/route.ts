import { route, readJson } from "@/lib/api";
import { previewAudience } from "@/lib/audience-service";
import { getSession } from "@/lib/session";

/** POST /api/audiences/preview { definition } → SegmentFunnel (live counts for the builder; read-only). */
export const POST = route(async (req) => {
  const body = (await readJson(req)) as { definition?: unknown };
  return previewAudience(await getSession(), body.definition);
});

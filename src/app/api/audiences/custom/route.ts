import { route, readJson } from "@/lib/api";
import { createPersona } from "@/lib/audience-service";
import { getSession } from "@/lib/session";

/** POST /api/audiences/custom { name, description, basedOn?, definition } → CustomPersona */
export const POST = route(async (req) => createPersona(await getSession(), await readJson(req)));

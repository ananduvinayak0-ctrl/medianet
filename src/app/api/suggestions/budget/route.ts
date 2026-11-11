import { route, readJson } from "@/lib/api";
import { createBudgetSuggestion } from "@/lib/campaign-service";
import { getSession } from "@/lib/session";

/** POST /api/suggestions/budget { personaKey, startAt, endAt, freqCapDay } → { id, suggestion } */
export const POST = route(async (req) => createBudgetSuggestion(await getSession(), await readJson(req)));

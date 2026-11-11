import { cookies } from "next/headers";
import { route, readJson } from "@/lib/api";
import { ROLES, type Role } from "@/lib/domain";
import { badRequest } from "@/lib/errors";
import { ROLE_COOKIE } from "@/lib/session";

export const POST = route(async (req) => {
  const { role } = (await readJson(req)) as { role?: string };
  if (!ROLES.includes(role as Role)) throw badRequest("Unknown role");
  (await cookies()).set(ROLE_COOKIE, role as string, { path: "/", sameSite: "lax", httpOnly: true });
  return { role };
});

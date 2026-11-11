import { cookies } from "next/headers";
import type { User, Workspace } from "@prisma/client";
import { db } from "./db";
import { ROLES, type Role } from "./domain";
import { advanceClock } from "./sim/runner";
import type { Actor } from "./audit";

// Demo session: real auth (Auth.js email + Google SSO) is a later ticket. For the MVP demo,
// a role switcher sets a cookie and we act as the seeded user holding that role.

export const ROLE_COOKIE = "demo_role";

export interface Session {
  workspace: Workspace;
  user: User;
  role: Role;
  simNow: Date;
  actor: Actor;
}

export async function getSession(): Promise<Session> {
  const jar = await cookies();
  const raw = jar.get(ROLE_COOKIE)?.value;
  const role: Role = ROLES.includes(raw as Role) ? (raw as Role) : "owner";
  const first = await db.workspace.findFirst();
  if (!first) throw new Error("No workspace found. Run `npm run setup` to seed demo data.");
  const simNow = await advanceClock(db, first.id);
  const workspace = await db.workspace.findUniqueOrThrow({ where: { id: first.id } });
  const m = await db.membership.findFirstOrThrow({ where: { workspaceId: workspace.id, role }, include: { user: true } });
  return { workspace, user: m.user, role, simNow, actor: { type: "user", id: m.user.id, name: m.user.name } };
}

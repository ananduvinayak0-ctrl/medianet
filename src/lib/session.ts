import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { User, Workspace } from "@prisma/client";
import type { Actor } from "./audit";
import { ensureControlGroup } from "./control-group";
import { db } from "./db";
import { ROLES, type Role } from "./domain";
import { quarterKey } from "./segment-defs";
import { advanceClock } from "./sim/runner";

// Open-access demo session. Anyone can log in from /login (no username or password); the login
// sets LOGIN_COOKIE. The role switcher then picks which seeded team member you act as.

export const LOGIN_COOKIE = "adbiz_session";
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
  if (!jar.get(LOGIN_COOKIE)?.value) redirect("/login");
  const raw = jar.get(ROLE_COOKIE)?.value;
  const role: Role = ROLES.includes(raw as Role) ? (raw as Role) : "owner";

  const first = await db.workspace.findFirst();
  if (!first) throw new Error("No workspace found. Run `npm run setup` to seed demo data.");
  const simNow = await advanceClock(db, first.id);
  let workspace = await db.workspace.findUniqueOrThrow({ where: { id: first.id } });
  if (workspace.controlPeriodKey !== quarterKey(simNow)) {
    await ensureControlGroup(db, workspace, simNow); // Rule 3: new quarter → new frozen control group
    workspace = await db.workspace.findUniqueOrThrow({ where: { id: first.id } });
  }
  const m = await db.membership.findFirstOrThrow({ where: { workspaceId: workspace.id, role }, include: { user: true } });
  return { workspace, user: m.user, role, simNow, actor: { type: "user", id: m.user.id, name: m.user.name } };
}

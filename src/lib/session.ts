import { getServerSession } from "next-auth";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { User, Workspace } from "@prisma/client";
import { audit, type Actor } from "./audit";
import { authOptions } from "./auth";
import { ensureControlGroup } from "./control-group";
import { db } from "./db";
import { ROLES, type Role } from "./domain";
import { quarterKey } from "./segment-defs";
import { advanceClock } from "./sim/runner";

// Session = the signed-in Google user + the (single) demo workspace.
// Anyone who signs in with Google joins the workspace on their first visit. The demo role
// switcher still works on top of that, so people can try each role's permissions; actions are
// always recorded under the real person's name in the audit log.

export const ROLE_COOKIE = "demo_role";

/** Role given to people the first time they sign in. */
const DEFAULT_ROLE: Role = "owner";

export interface Session {
  workspace: Workspace;
  user: User;
  image: string | null;
  role: Role;
  simNow: Date;
  actor: Actor;
}

export async function getSession(): Promise<Session> {
  const auth = await getServerSession(authOptions);
  const email = auth?.user?.email?.toLowerCase();
  if (!email) redirect("/login");

  const first = await db.workspace.findFirst();
  if (!first) throw new Error("No workspace found. Run `npm run setup` to seed demo data.");
  const simNow = await advanceClock(db, first.id);
  let workspace = await db.workspace.findUniqueOrThrow({ where: { id: first.id } });
  if (workspace.controlPeriodKey !== quarterKey(simNow)) {
    await ensureControlGroup(db, workspace, simNow); // Rule 3: new quarter → new frozen control group
    workspace = await db.workspace.findUniqueOrThrow({ where: { id: first.id } });
  }

  const user =
    (await db.user.findUnique({ where: { email } })) ??
    (await db.user.create({ data: { email, name: auth?.user?.name?.trim() || email.split("@")[0] } }).catch(async () => db.user.findUniqueOrThrow({ where: { email } })));
  let membership = await db.membership.findUnique({ where: { userId_workspaceId: { userId: user.id, workspaceId: workspace.id } } });
  if (!membership) {
    membership = await db.membership
      .create({ data: { userId: user.id, workspaceId: workspace.id, role: DEFAULT_ROLE } })
      .catch(async () => db.membership.findUniqueOrThrow({ where: { userId_workspaceId: { userId: user.id, workspaceId: workspace.id } } }));
    await audit(db, {
      workspaceId: workspace.id,
      actor: { type: "user", id: user.id, name: user.name },
      action: "user.joined",
      entityType: "user",
      entityId: user.id,
      summary: `${user.name} (${email}) signed in with Google for the first time`,
      at: simNow,
    });
  }

  const raw = (await cookies()).get(ROLE_COOKIE)?.value;
  const role: Role = ROLES.includes(raw as Role) ? (raw as Role) : (membership.role as Role);
  return { workspace, user, image: auth?.user?.image ?? null, role, simNow, actor: { type: "user", id: user.id, name: user.name } };
}

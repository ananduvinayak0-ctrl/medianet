import type { Role } from "./domain";

export type Permission =
  | "campaign:create"
  | "campaign:launch"
  | "campaign:pause"
  | "campaign:edit_daily_budget"
  | "campaign:raise_lifetime_cap"
  | "campaign:approve"
  | "wallet:topup"
  | "audit:view";

const MATRIX: Record<Role, Permission[]> = {
  owner: [
    "campaign:create",
    "campaign:launch",
    "campaign:pause",
    "campaign:edit_daily_budget",
    "campaign:raise_lifetime_cap",
    "campaign:approve",
    "wallet:topup",
    "audit:view",
  ],
  admin: [
    "campaign:create",
    "campaign:launch",
    "campaign:pause",
    "campaign:edit_daily_budget",
    "campaign:raise_lifetime_cap",
    "campaign:approve",
    "audit:view",
  ],
  editor: ["campaign:create", "campaign:launch", "campaign:pause", "campaign:edit_daily_budget"],
  viewer: [],
};

export function can(role: Role, perm: Permission): boolean {
  return MATRIX[role].includes(perm);
}

/** Editor launches above this lifetime budget need Owner/Admin approval. */
export const APPROVAL_THRESHOLD_PAISE = 50_000 * 100;

export function needsApproval(role: Role, lifetimeBudgetPaise: number): boolean {
  return role === "editor" && lifetimeBudgetPaise > APPROVAL_THRESHOLD_PAISE;
}

export const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  editor: "Editor",
  viewer: "Viewer",
};

export class ForbiddenError extends Error {
  status = 403;
}

export function assertCan(role: Role, perm: Permission): void {
  if (!can(role, perm)) throw new ForbiddenError(`Your role (${ROLE_LABEL[role]}) can't do this: ${perm}`);
}

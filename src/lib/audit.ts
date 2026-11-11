import type { Prisma, PrismaClient } from "@prisma/client";

export type Actor = { type: "user"; id: string; name: string } | { type: "system" } | { type: "ai" };

type Client = PrismaClient | Prisma.TransactionClient;

export const SYSTEM: Actor = { type: "system" };
export const AI: Actor = { type: "ai" };

/** Append-only audit entry. Every launch, pause, budget change and AI action goes through here. */
export async function audit(
  client: Client,
  e: {
    workspaceId: string;
    actor: Actor;
    action: string;
    entityType: string;
    entityId: string;
    summary: string;
    before?: unknown;
    after?: unknown;
    at: Date;
  },
): Promise<void> {
  await client.auditLog.create({
    data: {
      workspaceId: e.workspaceId,
      actorUserId: e.actor.type === "user" ? e.actor.id : null,
      actorName: e.actor.type === "user" ? e.actor.name : e.actor.type === "ai" ? "Budget Suggester (AI)" : "System",
      actorType: e.actor.type,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId,
      summary: e.summary,
      beforeJson: e.before === undefined ? null : JSON.stringify(e.before),
      afterJson: e.after === undefined ? null : JSON.stringify(e.after),
      createdAt: e.at,
    },
  });
}

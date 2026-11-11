import type { CustomPersona } from "@prisma/client";
import { z } from "zod";
import { audit } from "./audit";
import { db } from "./db";
import { PERSONA_KEYS } from "./domain";
import { badRequest, notFound } from "./errors";
import type { AudienceStats } from "./personas";
import { assertCan } from "./rbac";
import { definitionSchema, describeDefinition, filtersSchema, type SegmentDefinition, type SegmentFunnel } from "./segment-defs";
import { segmentFunnel, statsFromFunnel } from "./segments";
import type { Session } from "./session";

// Custom audiences (personas the brand defines): create, edit, archive, preview, and resolve
// for campaigns.

export const personaInput = z.object({
  name: z.string().trim().min(3, "Name needs at least 3 characters").max(60),
  description: z.string().trim().max(280).default(""),
  basedOn: z.enum(PERSONA_KEYS).nullish(),
  definition: definitionSchema,
});

export function definitionOf(p: Pick<CustomPersona, "channel" | "p1Days" | "p2Days" | "segments" | "filtersJson">): SegmentDefinition {
  let filters: unknown = {};
  try {
    filters = JSON.parse(p.filtersJson);
  } catch {
    // stored JSON is always ours; fall back to no filters rather than failing the page
  }
  return definitionSchema.parse({ channel: p.channel, p1Days: p.p1Days, p2Days: p.p2Days, segments: p.segments, filters: filtersSchema.parse(filters) });
}

export async function previewAudience(session: Session, raw: unknown): Promise<SegmentFunnel> {
  const parsed = definitionSchema.safeParse(raw);
  if (!parsed.success) throw badRequest("Invalid audience definition", parsed.error.flatten());
  return segmentFunnel(db, session.workspace, parsed.data, session.simNow);
}

function toData(v: z.infer<typeof personaInput>) {
  return {
    name: v.name,
    description: v.description,
    basedOn: v.basedOn ?? null,
    channel: v.definition.channel,
    p1Days: v.definition.p1Days,
    p2Days: v.definition.p2Days,
    segments: v.definition.segments,
    filtersJson: JSON.stringify(v.definition.filters),
  };
}

export async function createPersona(session: Session, raw: unknown): Promise<CustomPersona> {
  assertCan(session.role, "campaign:create");
  const parsed = personaInput.safeParse(raw);
  if (!parsed.success) throw badRequest("Please fix the highlighted fields", parsed.error.flatten());
  const p = await db.customPersona.create({ data: { ...toData(parsed.data), workspaceId: session.workspace.id, createdById: session.user.id } });
  await audit(db, {
    workspaceId: session.workspace.id,
    actor: session.actor,
    action: "audience.created",
    entityType: "audience",
    entityId: p.id,
    summary: `Audience "${p.name}" created: ${describeDefinition(parsed.data.definition).join("; ")}`,
    at: session.simNow,
  });
  return p;
}

async function loadPersona(session: Session, id: string): Promise<CustomPersona> {
  const p = await db.customPersona.findFirst({ where: { id, workspaceId: session.workspace.id } });
  if (!p) throw notFound("Audience not found");
  return p;
}

export async function updatePersona(session: Session, id: string, raw: unknown): Promise<CustomPersona> {
  assertCan(session.role, "campaign:create");
  const existing = await loadPersona(session, id);
  if (existing.archivedAt) throw badRequest("This audience is archived");
  const parsed = personaInput.safeParse(raw);
  if (!parsed.success) throw badRequest("Please fix the highlighted fields", parsed.error.flatten());
  const p = await db.customPersona.update({ where: { id }, data: toData(parsed.data) });
  await audit(db, {
    workspaceId: session.workspace.id,
    actor: session.actor,
    action: "audience.updated",
    entityType: "audience",
    entityId: id,
    summary: `Audience "${p.name}" updated: ${describeDefinition(parsed.data.definition).join("; ")}. Running campaigns keep the audience they launched with.`,
    before: definitionOf(existing),
    after: parsed.data.definition,
    at: session.simNow,
  });
  return p;
}

export async function archivePersona(session: Session, id: string): Promise<{ ok: true }> {
  assertCan(session.role, "campaign:create");
  const p = await loadPersona(session, id);
  await db.customPersona.update({ where: { id }, data: { archivedAt: session.simNow } });
  await audit(db, { workspaceId: session.workspace.id, actor: session.actor, action: "audience.archived", entityType: "audience", entityId: id, summary: `Audience "${p.name}" archived`, at: session.simNow });
  return { ok: true };
}

export interface ResolvedCustomAudience {
  persona: CustomPersona;
  def: SegmentDefinition;
  funnel: SegmentFunnel;
  stats: AudienceStats;
}

export async function resolveCustomAudience(session: Session, id: string): Promise<ResolvedCustomAudience> {
  const persona = await loadPersona(session, id);
  const def = definitionOf(persona);
  const funnel = await segmentFunnel(db, session.workspace, def, session.simNow);
  return { persona, def, funnel, stats: statsFromFunnel(funnel, def) };
}

export async function listCustomAudiences(session: Session): Promise<ResolvedCustomAudience[]> {
  const personas = await db.customPersona.findMany({ where: { workspaceId: session.workspace.id, archivedAt: null }, orderBy: { createdAt: "desc" } });
  return Promise.all(
    personas.map(async (persona) => {
      const def = definitionOf(persona);
      const funnel = await segmentFunnel(db, session.workspace, def, session.simNow);
      return { persona, def, funnel, stats: statsFromFunnel(funnel, def) };
    }),
  );
}

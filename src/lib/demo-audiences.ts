import type { CustomPersona, PrismaClient } from "@prisma/client";
import type { PersonaKey } from "./domain";
import { EMPTY_FILTERS, type SegmentDefinition } from "./segment-defs";

// Example custom audiences for the demo brand (used by the seed and the backfill script).

export const DEMO_AUDIENCES: { key: string; name: string; description: string; basedOn: PersonaKey | null; def: SegmentDefinition }[] = [
  {
    key: "lapsed_online",
    name: "Lapsed online regulars",
    description: "Bought online in the last year but not this quarter, and worth winning back (medium value and up).",
    basedOn: "lapsed_buyers",
    def: { channel: "online", p1Days: 90, p2Days: 270, segments: ["inactive"], filters: { ...EMPTY_FILTERS, valueTiers: ["medium", "high", "premium"] } },
  },
  {
    key: "group_potential",
    name: "Group shoppers new to Kaapi",
    description: "Shop at our sister brands but haven't bought from Kaapi in the last year.",
    basedOn: null,
    def: { channel: "any", p1Days: 90, p2Days: 270, segments: ["potential"], filters: EMPTY_FILTERS },
  },
  {
    key: "south_store_premium",
    name: "Premium store regulars (South)",
    description: "High-value in-store customers in the South, for early access to new single-origin beans.",
    basedOn: "high_value",
    def: { channel: "store", p1Days: 90, p2Days: 270, segments: ["active"], filters: { ...EMPTY_FILTERS, valueTiers: ["high", "premium"], regions: ["south"] } },
  },
];

export async function createDemoAudiences(db: PrismaClient, workspaceId: string, createdById: string, at: Date): Promise<Record<string, CustomPersona>> {
  const out: Record<string, CustomPersona> = {};
  for (const a of DEMO_AUDIENCES) {
    out[a.key] = await db.customPersona.create({
      data: {
        workspaceId,
        name: a.name,
        description: a.description,
        basedOn: a.basedOn,
        channel: a.def.channel,
        p1Days: a.def.p1Days,
        p2Days: a.def.p2Days,
        segments: a.def.segments,
        filtersJson: JSON.stringify(a.def.filters),
        createdById,
        createdAt: at,
      },
    });
  }
  return out;
}

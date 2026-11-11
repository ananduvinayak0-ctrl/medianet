import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AudienceBuilder } from "@/components/audiences/audience-builder";
import { PageHeader } from "@/components/ui";
import { db } from "@/lib/db";
import { PERSONA_KEYS, type PersonaKey } from "@/lib/domain";
import { can } from "@/lib/rbac";
import { DEFAULT_DEFINITION, SMART_PRESETS } from "@/lib/segment-defs";
import { segmentFunnel } from "@/lib/segments";
import { getSession } from "@/lib/session";

export default async function NewAudiencePage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const sp = await searchParams;
  const session = await getSession();
  const from = PERSONA_KEYS.includes(sp.from as PersonaKey) ? (sp.from as PersonaKey) : null;
  const def = from ? SMART_PRESETS[from].def : DEFAULT_DEFINITION;
  const funnel = await segmentFunnel(db, session.workspace, def, session.simNow);
  return (
    <>
      <Link href="/audiences" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
        <ArrowLeft className="size-4" aria-hidden /> Audiences
      </Link>
      <PageHeader title="New audience" description="Build an audience from your customer data, step by step. Counts update as you go. Nothing is contacted until a campaign launches." />
      <AudienceBuilder initial={{ name: from ? SMART_PRESETS[from].name : "", description: "", basedOn: from, def }} initialFunnel={funnel} canEdit={can(session.role, "campaign:create")} />
    </>
  );
}

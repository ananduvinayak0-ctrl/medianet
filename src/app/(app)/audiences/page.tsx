import Link from "next/link";
import { Plus, ShieldCheck, Sparkles, Users } from "lucide-react";
import { Badge, Callout, Card, CardBody, CardHeader, PageHeader } from "@/components/ui";
import { listCustomAudiences } from "@/lib/audience-service";
import { db } from "@/lib/db";
import { MIN_AUDIENCE } from "@/lib/domain";
import { formatDateTime, formatNum } from "@/lib/format";
import { allAudienceStats, PERSONAS } from "@/lib/personas";
import { can } from "@/lib/rbac";
import { describeDefinition } from "@/lib/segment-defs";
import { getSession } from "@/lib/session";

export default async function AudiencesPage() {
  const session = await getSession();
  const ws = session.workspace;
  const [custom, smart, usage, controlSize] = await Promise.all([
    listCustomAudiences(session),
    allAudienceStats(db, ws, session.simNow),
    db.campaign.groupBy({ by: ["customPersonaId"], where: { workspaceId: ws.id, customPersonaId: { not: null } }, _count: { _all: true } }),
    db.profile.count({ where: { workspaceId: ws.id, controlGroup: true } }),
  ]);
  const usedBy = new Map(usage.map((u) => [u.customPersonaId, u._count._all]));
  const canEdit = can(session.role, "campaign:create");

  return (
    <>
      <PageHeader
        title="Audiences"
        description="Build audiences from your customer data: who's eligible, their lifecycle stage, optional narrowing, then a fair target/control split. Smart Personas are ready-made starting points and extra signals."
        action={
          canEdit && (
            <Link href="/audiences/new" className="inline-flex h-10 items-center gap-1.5 rounded-md bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700">
              <Plus className="size-4" aria-hidden /> New audience
            </Link>
          )
        }
      />

      <section className="mb-8 space-y-4">
        <h2 className="text-base font-semibold text-slate-900">Your audiences</h2>
        {custom.length === 0 ? (
          <Card className="border-dashed">
            <CardBody className="space-y-2 text-sm text-slate-600">
              <p className="font-medium text-slate-900">No custom audiences yet</p>
              <p>
                Pick a purchase channel, choose lifecycle segments (Active, Inactive, Potential) using your own P1/P2 periods, and narrow by value, promo sensitivity, life stage, demographics, product affinity or
                geography if the offer needs it.
              </p>
              {canEdit && (
                <Link href="/audiences/new" className="inline-block font-medium text-brand-600 hover:underline">
                  Create your first audience →
                </Link>
              )}
            </CardBody>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {custom.map(({ persona, def, stats }) => (
              <Card key={persona.id}>
                <CardBody className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Users className="size-4 text-brand-600" aria-hidden />
                    <Link href={`/audiences/${persona.id}`} className="font-semibold text-slate-900 hover:underline">
                      {persona.name}
                    </Link>
                    {stats.eligible < MIN_AUDIENCE && <Badge tone="red">Below launch minimum</Badge>}
                    {usedBy.get(persona.id) ? <Badge tone="neutral">{usedBy.get(persona.id)} campaign(s)</Badge> : null}
                  </div>
                  {persona.description && <p className="text-sm text-slate-600">{persona.description}</p>}
                  <ul className="list-disc space-y-0.5 pl-5 text-sm text-slate-700">
                    {describeDefinition(def).map((l) => (
                      <li key={l}>{l}</li>
                    ))}
                  </ul>
                  <dl className="tabular grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <dt className="text-xs text-slate-500">Matching</dt>
                      <dd className="font-semibold">{formatNum(stats.total)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">Will be contacted</dt>
                      <dd className="font-semibold">{formatNum(stats.treated)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">Control</dt>
                      <dd className="font-semibold">{formatNum(stats.holdout)}</dd>
                    </div>
                  </dl>
                  <div className="flex flex-wrap gap-4 text-sm font-medium">
                    <Link href={`/campaigns/new?audience=${persona.id}`} className="text-brand-600 hover:underline">
                      Use in a campaign →
                    </Link>
                    <Link href={`/audiences/${persona.id}`} className="text-slate-600 hover:underline">
                      Results &amp; edit
                    </Link>
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>
        )}
      </section>

      <Card className="mb-8">
        <CardHeader
          title={
            <span className="inline-flex items-center gap-2">
              <ShieldCheck className="size-4 text-emerald-600" aria-hidden /> Control group: {ws.controlPeriodKey ?? "not set"}
            </span>
          }
          description={`${ws.holdoutPct}% of customers in every lifecycle × value tier × channel group are held out from all campaigns this quarter, so every campaign is measured against the same fair baseline.`}
        />
        <CardBody className="tabular text-sm text-slate-600">
          {formatNum(controlSize)} customers in control{ws.controlRefreshedAt ? ` · drawn ${formatDateTime(ws.controlRefreshedAt)}` : ""} · redrawn automatically when the next quarter starts.
        </CardBody>
      </Card>

      <section className="space-y-4">
        <div>
          <h2 className="inline-flex items-center gap-2 text-base font-semibold text-slate-900">
            <Sparkles className="size-4 text-brand-600" aria-hidden /> Smart Personas
          </h2>
          <p className="text-sm text-slate-600">Ready-made audiences from pixel and store behaviour. Use one as is, or customise it as a starting point for your own audience.</p>
        </div>
        <Callout tone="blue" title="How your customers' data is handled">
          Emails and device IDs are SHA-256 hashed before upload, so we never store raw contact details. Hashes are still personal data under the DPDP Act 2023: encrypted at rest, access-logged, and deleted 30 days after you disconnect. People on the do-not-contact list or who opt out are never contacted.
        </Callout>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {PERSONAS.map((p) => {
            const s = smart[p.key];
            return (
              <Card key={p.key}>
                <CardBody className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-900">{p.name}</span>
                    <Badge tone={p.objective === "retarget" ? "blue" : "violet"}>{p.objective === "retarget" ? "Retarget" : "Reactivate"}</Badge>
                    {s.eligible < MIN_AUDIENCE && <Badge tone="red">Below launch minimum</Badge>}
                  </div>
                  <p className="text-sm text-slate-700">
                    {p.definition}
                    {p.excludesRecentBuyers && " Excludes anyone who bought in the last 30 days."}
                  </p>
                  <p className="tabular text-xs text-slate-500">
                    {formatNum(s.total)} match · {formatNum(s.treated)} will see ads · {formatNum(s.holdout)} control · {formatNum(s.doNotContact + s.consentWithdrawn)} can&apos;t be contacted
                  </p>
                  <div className="flex flex-wrap gap-4 text-sm font-medium">
                    <Link href={`/campaigns/new?persona=${p.key}`} className="text-brand-600 hover:underline">
                      Use as is →
                    </Link>
                    {canEdit && (
                      <Link href={`/audiences/new?from=${p.key}`} className="text-slate-600 hover:underline">
                        Customise
                      </Link>
                    )}
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      </section>
    </>
  );
}

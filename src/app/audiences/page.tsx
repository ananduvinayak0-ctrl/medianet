import Link from "next/link";
import { Lock, Users } from "lucide-react";
import { Badge, Callout, Card, CardBody, PageHeader } from "@/components/ui";
import { db } from "@/lib/db";
import { MIN_AUDIENCE } from "@/lib/domain";
import { formatDateTime, formatNum } from "@/lib/format";
import { allAudienceStats, PERSONAS } from "@/lib/personas";
import { getSession } from "@/lib/session";

export default async function AudiencesPage() {
  const session = await getSession();
  const stats = await allAudienceStats(db, session.workspace, session.simNow);
  return (
    <>
      <PageHeader
        title="Smart Personas"
        description="Rule-based retention segments built from your pixel and store data. Every rule is shown in plain language, with no black boxes. Sizes already exclude people who withdrew consent and keep the 10% holdout aside."
      />
      <Callout tone="blue" className="mb-6" title="How your customers' data is handled">
        Emails and device IDs are SHA-256 hashed in the browser before upload, so we never store raw contact details. Hashes are still treated as personal data under the DPDP Act 2023: encrypted at rest, access-logged, and deleted 30 days after you disconnect. Anyone who withdraws consent drops out of every audience within 24 hours.
      </Callout>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {PERSONAS.map((p) => {
          const s = stats[p.key];
          const pct = (n: number) => (s.total > 0 ? `${Math.round((n / s.total) * 100)}%` : "0%");
          return (
            <Card key={p.key}>
              <CardBody className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Users className="size-4 text-brand-600" aria-hidden />
                  <h2 className="font-semibold text-slate-900">{p.name}</h2>
                  <Badge tone={p.objective === "retarget" ? "blue" : "violet"}>{p.objective === "retarget" ? "Retarget" : "Reactivate"}</Badge>
                  {s.eligible < MIN_AUDIENCE && <Badge tone="red">Below launch minimum</Badge>}
                </div>
                <p className="text-sm text-slate-700">
                  <span className="font-medium">Rule:</span> {p.definition}
                  {p.excludesRecentBuyers && " Excludes anyone who bought in the last 30 days."}
                </p>
                <p className="text-sm text-slate-500">{p.why}</p>
                <dl className="tabular grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                  <div>
                    <dt className="text-xs text-slate-500">Match the rule</dt>
                    <dd className="font-semibold">{formatNum(s.total)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Will see ads</dt>
                    <dd className="font-semibold">{formatNum(s.treated)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Holdout</dt>
                    <dd className="font-semibold">{formatNum(s.holdout)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Not reachable</dt>
                    <dd className="font-semibold">{formatNum(s.unmatched)}</dd>
                  </div>
                </dl>
                <p className="text-xs text-slate-500">
                  {pct(s.consentWithdrawn)} excluded for withdrawn consent{p.excludesRecentBuyers ? ` · ${pct(s.recentBuyersExcluded)} excluded as recent buyers` : ""} · refreshed {formatDateTime(session.simNow)}
                </p>
                <Link href={`/campaigns/new?persona=${p.key}`} className="inline-block text-sm font-medium text-brand-600 hover:underline">
                  Create a campaign for this audience →
                </Link>
              </CardBody>
            </Card>
          );
        })}
        <Card className="border-dashed">
          <CardBody className="space-y-2 text-sm text-slate-500">
            <div className="flex items-center gap-2 font-medium text-slate-700">
              <Lock className="size-4" aria-hidden /> AI-recommended personas (lookalikes, predicted churn)
            </div>
            <p>Planned for after MVP, once enough campaigns exist to validate them against holdouts. Each will show the signals it uses and its measured lift before you can select it.</p>
          </CardBody>
        </Card>
      </div>
    </>
  );
}

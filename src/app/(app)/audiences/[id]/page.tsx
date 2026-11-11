import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Megaphone } from "lucide-react";
import { AudienceBuilder } from "@/components/audiences/audience-builder";
import { StatusBadge } from "@/components/campaign-bits";
import { Badge, Card, CardBody, CardHeader, PageHeader } from "@/components/ui";
import { resolveCustomAudience } from "@/lib/audience-service";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { formatDate, formatINR, formatNum } from "@/lib/format";
import { liftFor } from "@/lib/metrics";
import { campaignTotalsMap } from "@/lib/queries";
import { can } from "@/lib/rbac";
import { getSession } from "@/lib/session";

const pctSigned = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(0)}%`;

export default async function AudiencePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  const resolved = await resolveCustomAudience(session, id).catch((e) => {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  });
  const { persona, def, funnel } = resolved;
  const campaigns = await db.campaign.findMany({ where: { customPersonaId: id, workspaceId: session.workspace.id }, orderBy: { startAt: "desc" } });
  const totals = await campaignTotalsMap(campaigns.map((c) => c.id));
  const results = campaigns
    .filter((c) => c.launchedAt)
    .map((c) => {
      const t = totals.get(c.id)!;
      return { c, t, lift: liftFor(t, c.treatedUsers, c.holdoutUsers) };
    });
  const proven = results.filter((r) => r.lift.significant);

  return (
    <>
      <Link href="/audiences" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
        <ArrowLeft className="size-4" aria-hidden /> Audiences
      </Link>
      <PageHeader
        title={persona.name}
        description={persona.archivedAt ? "Archived. Shown for its history; it can't be used in new campaigns." : persona.description || "Custom audience"}
        action={
          !persona.archivedAt && (
            <Link href={`/campaigns/new?audience=${persona.id}`} className="inline-flex h-10 items-center gap-1.5 rounded-md bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700">
              <Megaphone className="size-4" aria-hidden /> Use in a campaign
            </Link>
          )
        }
      />

      {/* Rule 6: what we learned from campaigns on this audience */}
      <Card className="mb-6">
        <CardHeader
          title="Results: target vs control"
          description="Each campaign on this audience compared with its control group. Use this to plan the next one."
          action={results.length > 0 ? <Badge tone={proven.length ? "green" : "neutral"}>{proven.length} of {results.length} showed real lift</Badge> : undefined}
        />
        {results.length === 0 ? (
          <CardBody className="text-sm text-slate-600">No campaigns have run on this audience yet. Results appear here once one launches.</CardBody>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-2 font-medium">Campaign</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">Contacted / control</th>
                  <th className="px-3 py-2 text-right font-medium">Bought: target</th>
                  <th className="px-3 py-2 text-right font-medium">Bought: control</th>
                  <th className="px-3 py-2 text-right font-medium">Lift</th>
                  <th className="px-5 py-2 text-right font-medium">Spend</th>
                </tr>
              </thead>
              <tbody className="tabular divide-y divide-slate-100">
                {results.map(({ c, t, lift }) => (
                  <tr key={c.id}>
                    <td className="px-5 py-2.5">
                      <Link href={`/campaigns/${c.id}`} className="font-medium text-slate-900 hover:underline">
                        {c.name}
                      </Link>
                      <div className="text-xs text-slate-500">
                        {c.code} · {formatDate(c.startAt)}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusBadge status={c.status} />
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {formatNum(c.treatedUsers)} / {formatNum(c.holdoutUsers)}
                    </td>
                    <td className="px-3 py-2.5 text-right">{(lift.treatedRate * 100).toFixed(2)}%</td>
                    <td className="px-3 py-2.5 text-right">{(lift.holdoutRate * 100).toFixed(2)}%</td>
                    <td className="px-3 py-2.5 text-right">
                      {lift.status === "insufficient_data" ? (
                        <span className="text-xs text-slate-500">not enough data</span>
                      ) : (
                        <span className={lift.significant ? "font-semibold text-emerald-700" : "text-slate-600"}>
                          {pctSigned(lift.relativeLift)}
                          {!lift.significant && <span className="ml-1 text-xs">(inconclusive)</span>}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-2.5 text-right">{formatINR(t.spendPaise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <AudienceBuilder
        initial={{ id: persona.id, name: persona.name, description: persona.description, basedOn: (persona.basedOn as never) ?? null, def }}
        initialFunnel={funnel}
        canEdit={can(session.role, "campaign:create") && !persona.archivedAt}
      />
    </>
  );
}

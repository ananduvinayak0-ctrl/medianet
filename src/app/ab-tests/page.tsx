import Link from "next/link";
import { EyeOff, FlaskConical } from "lucide-react";
import { StatusBadge } from "@/components/campaign-bits";
import { Badge, Card, CardBody, PageHeader, ProgressBar } from "@/components/ui";
import { VERDICT_LABEL, type AbVerdict } from "@/lib/abtest";
import { db } from "@/lib/db";
import { formatDateTime, formatNum } from "@/lib/format";
import { getSession } from "@/lib/session";

const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;

export default async function AbTestsPage() {
  const session = await getSession();
  const tests = await db.abTest.findMany({
    where: { campaign: { workspaceId: session.workspace.id } },
    include: { campaign: { select: { id: true, code: true, name: true, status: true } } },
    orderBy: [{ startedAt: { sort: "desc", nulls: "first" } }],
  });

  return (
    <>
      <PageHeader
        title="A/B tests"
        description="Creative tests with a sample size fixed before launch. Each one ends with an honest answer: A wins, B wins, or inconclusive. Add a test in the Creative step when you create a campaign."
        action={
          <Link href="/campaigns/new" className="inline-flex h-10 items-center gap-1.5 rounded-md bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700">
            <FlaskConical className="size-4" aria-hidden /> New campaign with a test
          </Link>
        }
      />

      {tests.length === 0 ? (
        <Card>
          <CardBody className="space-y-1 text-sm text-slate-600">
            <p className="font-medium text-slate-900">No A/B tests yet</p>
            <p>Create a campaign, and in step 4 (Creative) click &quot;Add variant B&quot;. You&apos;ll see the required sample size and cost before you launch.</p>
          </CardBody>
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-2.5 font-medium">Campaign</th>
                <th className="px-5 py-2.5 font-medium">Testing</th>
                <th className="px-5 py-2.5 font-medium">Result</th>
                <th className="px-5 py-2.5 font-medium">Progress</th>
                <th className="px-5 py-2.5 font-medium">Started</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tests.map((t) => {
                const progress = t.samplePerVariant > 0 ? Math.min(t.impressionsA, t.impressionsB) : 0;
                const verdict = t.verdict as AbVerdict | null;
                return (
                  <tr key={t.id} className="align-top hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <Link href={`/campaigns/${t.campaign.id}`} className="font-medium text-slate-900 hover:underline">
                        {t.campaign.name}
                      </Link>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                        {t.campaign.code} <StatusBadge status={t.campaign.status} />
                      </div>
                    </td>
                    <td className="max-w-xs px-5 py-3 text-slate-700">
                      <div className="truncate">
                        <span className="text-xs font-semibold text-slate-500">A</span> {t.status === "draft" ? "(campaign creative)" : t.aHeadline}
                      </div>
                      <div className="truncate">
                        <span className="text-xs font-semibold text-slate-500">B</span> {t.bHeadline}
                      </div>
                      <div className="text-xs text-slate-500">CTR, ≥{t.mdePct}% difference</div>
                    </td>
                    <td className="px-5 py-3">
                      {t.status === "draft" && <Badge tone="neutral">Not launched</Badge>}
                      {t.status === "running" && (
                        <Badge tone="blue">
                          <EyeOff className="size-3" aria-hidden /> Running · hidden
                        </Badge>
                      )}
                      {t.status === "complete" && verdict && (
                        <div className="space-y-1">
                          <Badge tone={verdict === "inconclusive" ? "amber" : "green"}>{VERDICT_LABEL[verdict]}</Badge>
                          {t.relLift !== null && <div className="tabular text-xs text-slate-600">B vs A: {pct(t.relLift)}</div>}
                          {t.winnerAppliedAt && <div className="text-xs text-emerald-700">Switched to B</div>}
                        </div>
                      )}
                    </td>
                    <td className="w-48 px-5 py-3">
                      {t.status === "draft" ? (
                        <span className="text-xs text-slate-500">—</span>
                      ) : (
                        <div className="space-y-1">
                          <ProgressBar value={progress} max={t.samplePerVariant} label="Sample collected" />
                          <div className="tabular text-xs text-slate-500">
                            {formatNum(progress)} / {formatNum(t.samplePerVariant)} per variant
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-3 text-xs text-slate-500">{t.startedAt ? formatDateTime(t.startedAt) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}

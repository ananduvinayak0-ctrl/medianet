"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { EyeOff, FlaskConical } from "lucide-react";
import { AB_MAX_BUDGET_SHARE, VERDICT_LABEL, type AbTestView } from "@/lib/abtest";
import { api, ApiError } from "@/lib/client";
import { formatDateTime, formatINR, formatNum, formatPct } from "@/lib/format";
import { Badge, Button, Callout, Card, CardBody, CardHeader, cn, ProgressBar } from "../ui";

const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;

export function AbTestCard({ test, campaignId, campaignStatus, canAct }: { test: AbTestView; campaignId: string; campaignStatus: string; canAct: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const r = test.result;

  async function applyWinner() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/campaigns/${campaignId}/apply-ab-winner`, { body: {}, idempotent: true });
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const badge =
    test.status === "draft" ? (
      <Badge tone="neutral">Starts at launch</Badge>
    ) : test.status === "running" ? (
      <Badge tone="blue">
        <EyeOff className="size-3" aria-hidden /> Running · results hidden
      </Badge>
    ) : r?.verdict === "inconclusive" ? (
      <Badge tone="amber">Inconclusive</Badge>
    ) : (
      <Badge tone="green">{VERDICT_LABEL[r!.verdict]}</Badge>
    );

  const winner = r?.verdict === "a_wins" ? "a" : r?.verdict === "b_wins" ? "b" : null;

  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <FlaskConical className="size-4 text-brand-600" aria-hidden /> A/B test: creative
          </span>
        }
        description={`Measured on click-through rate. Looking for a difference of at least ${test.mdePct}%.`}
        action={badge}
      />
      <CardBody className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(["a", "b"] as const).map((v) => {
            const cr = v === "a" ? test.variantA : test.variantB;
            const imps = v === "a" ? test.impressionsA : test.impressionsB;
            return (
              <div key={v} className={cn("rounded-md border p-3", winner === v ? "border-emerald-300 bg-emerald-50/50" : "border-slate-200")}>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Variant {v.toUpperCase()}{v === "a" ? " (current)" : ""}</span>
                  {winner === v && <Badge tone="green">Winner</Badge>}
                </div>
                <div className="font-medium text-slate-900">{cr.headline}</div>
                <p className="text-sm text-slate-600">{cr.body}</p>
                <span className="mt-1 inline-block rounded bg-slate-900 px-2 py-0.5 text-xs font-medium text-white">{cr.cta}</span>
                {test.status === "running" && (
                  <div className="mt-3 space-y-1">
                    <div className="tabular flex justify-between text-xs text-slate-600">
                      <span>Impressions</span>
                      <span>
                        {formatNum(Math.min(imps, test.samplePerVariant))} / {formatNum(test.samplePerVariant)}
                      </span>
                    </div>
                    <ProgressBar value={imps} max={test.samplePerVariant} label={`Variant ${v.toUpperCase()} sample collected`} />
                  </div>
                )}
                {r && (
                  <div className="tabular mt-3 text-sm text-slate-700">
                    CTR <span className="font-semibold">{formatPct(v === "a" ? r.ctrA : r.ctrB)}</span>
                    <span className="text-xs text-slate-500">
                      {" "}
                      · {formatNum(v === "a" ? r.clicksA : r.clicksB)} clicks / {formatNum(imps)} impressions
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {test.status === "draft" && (
          <p className="text-sm text-slate-600">
            When the campaign launches, test traffic is split 50/50 between A and B until each reaches its planned sample. The test can use at most {AB_MAX_BUDGET_SHARE * 100}% of the
            campaign budget. After that, the campaign runs variant A only.
          </p>
        )}

        {test.status === "running" && (
          <>
            <div className="space-y-1">
              <div className="tabular flex justify-between text-sm">
                <span className="text-slate-600">Test spend</span>
                <span className="font-medium">
                  {formatINR(test.spendPaise)} / {formatINR(test.testBudgetCapPaise)}
                </span>
              </div>
              <ProgressBar value={test.spendPaise} max={test.testBudgetCapPaise} tone={test.spendPaise / Math.max(1, test.testBudgetCapPaise) > 0.9 ? "amber" : "blue"} label="Test budget used" />
            </div>
            <Callout tone="blue" title="Why can't I see which one is ahead?">
              Results stay hidden until both variants reach {formatNum(test.samplePerVariant)} impressions. Early numbers swing a lot, and stopping a test the moment one variant looks ahead is the most common way A/B tests crown a false winner.
            </Callout>
          </>
        )}

        {r && (
          <div className="space-y-2">
            {r.relLift !== null && r.ciLow !== null && r.ciHigh !== null && (
              <div className="tabular grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <div className="text-xs text-slate-500">B vs A (CTR)</div>
                  <div className="text-xl font-semibold">{pct(r.relLift)}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">95% range</div>
                  <div className="text-xl font-semibold">
                    {pct(r.ciLow)} to {pct(r.ciHigh)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">p-value</div>
                  <div className="text-xl font-semibold">{r.pValue !== null ? r.pValue.toFixed(3) : "—"}</div>
                </div>
              </div>
            )}
            <p className="text-sm text-slate-700">
              {r.verdict === "b_wins" && "Variant B gets clicked more often, and the difference is bigger than random noise would explain."}
              {r.verdict === "a_wins" && "Your original creative (A) gets clicked more often. Keep running it."}
              {r.verdict === "inconclusive" &&
                (r.reason
                  ? `No winner: ${r.reason}`
                  : "No winner. The two variants performed too similarly to tell apart with this sample. That's a real answer: the change didn't matter much. Keep A, or test a bolder change.")}
            </p>
            {r.completedAt && <p className="text-xs text-slate-500">Finished {formatDateTime(r.completedAt)}</p>}
            {r.verdict === "b_wins" &&
              (r.winnerApplied ? (
                <Badge tone="green">Campaign now runs variant B</Badge>
              ) : canAct && !["completed", "stopped"].includes(campaignStatus) ? (
                <div className="space-y-2">
                  <Button size="sm" onClick={applyWinner} disabled={busy}>
                    {busy ? "Switching…" : "Switch campaign to variant B"}
                  </Button>
                  {error && <p className="text-sm text-red-600">{error}</p>}
                </div>
              ) : null)}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

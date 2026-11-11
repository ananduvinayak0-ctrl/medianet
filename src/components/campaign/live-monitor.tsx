"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Info, Radio, ShieldAlert } from "lucide-react";
import { api } from "@/lib/client";
import { formatINR, formatNum, formatPct, formatRatio } from "@/lib/format";
import type { MonitorData } from "@/lib/monitor";
import { HourlyLine } from "../charts";
import { LiftCard } from "../campaign-bits";
import { Badge, Button, Card, CardBody, CardHeader, ProgressBar, Stat } from "../ui";
import { AbTestCard } from "./ab-test-card";

const POLL_MS = 5000;

export function LiveMonitor({ initial, canAct }: { initial: MonitorData; canAct: boolean }) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [lastSync, setLastSync] = useState(Date.now());
  const [stale, setStale] = useState(false);
  const [now, setNow] = useState(Date.now());
  const statusRef = useRef(initial.campaign.status);
  const polling = ["live", "scheduled"].includes(data.campaign.status);

  useEffect(() => setData(initial), [initial]);

  useEffect(() => {
    if (!polling) return;
    const t = setInterval(async () => {
      try {
        const d = await api<MonitorData>(`/api/campaigns/${initial.campaign.id}/live`, { method: "GET" });
        setData(d);
        setLastSync(Date.now());
        setStale(false);
        if (d.campaign.status !== statusRef.current) {
          statusRef.current = d.campaign.status;
          router.refresh(); // status changed (auto-pause, completion) → refresh controls
        }
      } catch {
        setStale(true);
      }
    }, POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(t);
      clearInterval(tick);
    };
  }, [polling, initial.campaign.id, router]);

  const c = data.campaign;
  const t = data.totals;
  const d = data.derived;
  const agoS = Math.round((now - lastSync) / 1000);
  const dailyPct = c.dailyBudgetPaise > 0 ? data.today.spendPaise / c.dailyBudgetPaise : 0;

  async function alertAction(alertId: string, kind: string, action: "dismiss" | "apply") {
    if (action === "apply" && kind === "cpa_high") {
      const daily = Math.round((c.dailyBudgetPaise * 0.75) / 10_000) * 100;
      await api(`/api/campaigns/${c.id}/budget`, { body: { dailyBudgetRupees: Math.max(500, daily), lifetimeBudgetRupees: c.lifetimeBudgetPaise / 100, reason: "Applied CPA alert suggestion (−25%)", alertId }, idempotent: true });
    } else {
      await api(`/api/alerts/${alertId}`, { body: { status: action === "apply" ? "actioned" : "dismissed" } });
    }
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
        {polling ? (
          <span className="inline-flex items-center gap-1.5">
            <Radio className={`size-4 ${stale ? "text-red-500" : "text-emerald-600"}`} aria-hidden />
            {stale ? "Data delayed. Retrying… Your pause button still works." : `Near real-time · updated ${agoS}s ago`}
          </span>
        ) : (
          <span>Not delivering right now{c.statusReason ? ` · ${c.statusReason}` : ""}.</span>
        )}
        {data.provisionalConversions > 0 && <Badge tone="neutral">{formatNum(data.provisionalConversions)} conversions still provisional (7-day window)</Badge>}
        {data.inFlightSpendPaise > 0 && <Badge tone="neutral">{formatINR(data.inFlightSpendPaise)} spend not yet reported by channel</Badge>}
      </div>

      {data.alerts.length > 0 && (
        <div className="space-y-2">
          {data.alerts.map((a) => {
            const Icon = a.severity === "critical" ? ShieldAlert : a.severity === "warning" ? AlertTriangle : Info;
            const style = a.severity === "critical" ? "border-red-200 bg-red-50" : a.severity === "warning" ? "border-amber-200 bg-amber-50" : "border-brand-200 bg-brand-50";
            return (
              <div key={a.id} className={`flex flex-wrap items-start gap-3 rounded-md border px-4 py-3 text-sm ${style}`}>
                <Icon className="mt-0.5 size-4 shrink-0" aria-label={a.severity} />
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-slate-900">
                    {a.message} {a.autoActioned && <Badge tone="red">auto-action (safety rule)</Badge>}
                  </div>
                  {a.recommendation && <div className="text-slate-700">{a.recommendation}</div>}
                </div>
                {canAct && a.kind !== "learning" && (
                  <div className="flex gap-2">
                    {a.kind === "cpa_high" && (
                      <Button size="sm" onClick={() => alertAction(a.id, a.kind, "apply")}>
                        Apply −25% budget
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => alertAction(a.id, a.kind, "dismiss")}>
                      Dismiss
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Impressions" value={formatNum(t.impressions)} sub={`${formatNum(data.today.impressions)} today`} />
        <Stat label="Clicks · CTR" value={formatNum(t.clicks)} sub={`CTR ${formatPct(d.ctr)}`} />
        <Stat label="Conversions" value={formatNum(t.conversions)} sub={t.conversions > 0 ? `${formatINR(d.cpaPaise)} each` : "none yet"} />
        <Stat label="ROAS" value={t.spendPaise > 0 ? formatRatio(d.roas) : "—"} sub={`${formatINR(t.revenuePaise)} revenue`} />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Card>
          <CardBody className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Today&apos;s spend</span>
              <span className="tabular font-medium">
                {formatINR(data.today.spendPaise)} / {formatINR(c.dailyBudgetPaise)}
              </span>
            </div>
            <ProgressBar value={data.today.spendPaise} max={c.dailyBudgetPaise} label="Daily budget used" />
            <p className="text-xs text-slate-500">Paced through the day (more in evenings). Resets at midnight IST.</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Spend ceiling</span>
              <span className="tabular font-medium">
                {formatINR(c.totalSpendPaise)} / {formatINR(c.lifetimeBudgetPaise)}
              </span>
            </div>
            <ProgressBar value={c.totalSpendPaise} max={c.lifetimeBudgetPaise} tone={c.totalSpendPaise / c.lifetimeBudgetPaise > 0.9 ? "amber" : "blue"} label="Lifetime cap used" />
            <p className="text-xs text-slate-500">Hard stop: delivery ends automatically at the ceiling.</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Frequency today</span>
              <span className="tabular font-medium">
                {data.today.frequency.toFixed(1)} / {c.freqCapDay} per person
              </span>
            </div>
            <ProgressBar value={data.today.frequency} max={c.freqCapDay} tone={data.today.frequency >= c.freqCapDay * 0.95 ? "amber" : "green"} label="Frequency cap used" />
            <p className="text-xs text-slate-500">
              {dailyPct < 0.6 && data.today.frequency >= c.freqCapDay * 0.95 ? "Audience saturated. More budget won't buy more reach today." : "Average ads seen per person today."}
            </p>
          </CardBody>
        </Card>
      </div>

      {data.hourly.length > 1 && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Card>
            <CardHeader title="Spend per hour" description="Last 48 hours (IST)" />
            <CardBody>
              <HourlyLine data={data.hourly} dataKey="spend" label="Spend" format="inr" series={0} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Clicks per hour" description="Last 48 hours (IST)" />
            <CardBody>
              <HourlyLine data={data.hourly} dataKey="clicks" label="Clicks" series={2} />
            </CardBody>
          </Card>
        </div>
      )}

      {data.abTest && <AbTestCard test={data.abTest} campaignId={c.id} campaignStatus={c.status} canAct={canAct} />}

      {t.spendPaise > 0 && <LiftCard lift={data.lift} scope={`${formatNum(c.treatedUsers)} people could see ads; ${formatNum(c.holdoutUsers)} were held out. Same brand-level holdout across all campaigns.`} />}
    </div>
  );
}

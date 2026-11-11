import Link from "next/link";
import { AlertTriangle, CalendarClock, CheckCircle2, CircleAlert, Info, ShieldAlert } from "lucide-react";
import { DailyBars } from "@/components/charts";
import { LiftCard, StatusBadge } from "@/components/campaign-bits";
import { Badge, Callout, Card, CardBody, CardHeader, PageHeader, Select, Stat } from "@/components/ui";
import { nextPeak } from "@/lib/calendar";
import { db } from "@/lib/db";
import { PERSONA_KEYS } from "@/lib/domain";
import { formatDate, formatINR, formatNum, formatRatio } from "@/lib/format";
import { dailySeries, derive, liftFor, sumBuckets } from "@/lib/metrics";
import { getPersona, PERSONAS } from "@/lib/personas";
import { healthSummary, pixelHealth } from "@/lib/pixel";
import { campaignTotalsMap, pooledLiftInputs } from "@/lib/queries";
import { getSession } from "@/lib/session";
import { computeLift } from "@/lib/stats";
import { DAY, istDayKey, istDayStart } from "@/lib/time";
import { walletSummary } from "@/lib/wallet";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ persona?: string; status?: string }> }) {
  const sp = await searchParams;
  const session = await getSession();
  const ws = session.workspace;
  const now = session.simNow;
  const from = new Date(istDayStart(now).getTime() - 29 * DAY);
  const days = Array.from({ length: 30 }, (_, i) => istDayKey(new Date(from.getTime() + i * DAY + 12 * 3600_000)));

  const [campaigns, buckets, alerts, pixelRows, wallet] = await Promise.all([
    db.campaign.findMany({ where: { workspaceId: ws.id }, orderBy: { startAt: "desc" } }),
    db.metricBucket.findMany({ where: { campaign: { workspaceId: ws.id }, bucketStart: { gte: from } } }),
    db.alert.findMany({ where: { workspaceId: ws.id, status: "open" }, orderBy: { createdAt: "desc" }, take: 6, include: { campaign: { select: { code: true, name: true } } } }),
    db.pixelEventDaily.findMany({ where: { workspaceId: ws.id } }),
    walletSummary(db, ws.id),
  ]);

  const totals30 = sumBuckets(buckets);
  const d30 = derive(totals30);
  const series = dailySeries(buckets, days);
  const totalsByCampaign = await campaignTotalsMap(campaigns.map((c) => c.id));
  const recent = campaigns.filter((c) => c.endAt >= from && c.launchedAt);
  const p = pooledLiftInputs(recent, totalsByCampaign);
  const pooled = computeLift(p.tc, p.tn, p.hc, p.hn);
  const checks = pixelHealth(pixelRows, now);
  const pixelStatus = healthSummary(checks);
  const peak = nextPeak(istDayKey(now));

  const filtered = campaigns.filter((c) => (!sp.persona || c.personaKey === sp.persona) && (!sp.status || c.status === sp.status));

  const onboarding = [
    { label: "Connect your store", done: Boolean(ws.storeConnectedAt), detail: "Shopify (mock) connected" },
    { label: "Install the pixel", done: Boolean(ws.pixelInstalledAt), detail: pixelStatus === "ok" ? "Healthy" : "Installed, needs attention", warn: pixelStatus !== "ok" },
    { label: "Fund your wallet", done: wallet.balancePaise > 0, detail: `${formatINR(wallet.availablePaise)} available` },
  ];

  return (
    <>
      <PageHeader
        title="Overview"
        description="Last 30 days across all campaigns. Attributed results use a 7-day click / 1-day view window, de-duplicated by order ID. The last 7 days are provisional."
      />

      <div className="mb-6 grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Needs your attention" description="Hard safety rules act automatically. Everything else is only a suggestion." />
          <CardBody className="space-y-2">
            {alerts.length === 0 && <p className="text-sm text-slate-500">All clear. No open alerts.</p>}
            {alerts.map((a) => {
              const Icon = a.severity === "critical" ? ShieldAlert : a.severity === "warning" ? AlertTriangle : Info;
              const color = a.severity === "critical" ? "text-red-600" : a.severity === "warning" ? "text-amber-600" : "text-brand-600";
              return (
                <div key={a.id} className="flex items-start gap-3 rounded-md border border-slate-100 px-3 py-2">
                  <Icon className={`mt-0.5 size-4 shrink-0 ${color}`} aria-label={a.severity} />
                  <div className="min-w-0 flex-1 text-sm">
                    <div className="text-slate-800">{a.message}</div>
                    {a.recommendation && <div className="text-slate-500">{a.recommendation}</div>}
                  </div>
                  {a.campaignId ? (
                    <Link href={`/campaigns/${a.campaignId}`} className="shrink-0 text-sm font-medium text-brand-600 hover:underline">
                      {a.campaign?.code}
                    </Link>
                  ) : (
                    <Link href="/wallet" className="shrink-0 text-sm font-medium text-brand-600 hover:underline">
                      Wallet
                    </Link>
                  )}
                </div>
              );
            })}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Setup" />
          <CardBody className="space-y-2.5">
            {onboarding.map((o) => (
              <div key={o.label} className="flex items-start gap-2 text-sm">
                {o.done && !o.warn ? <CheckCircle2 className="mt-0.5 size-4 text-emerald-600" aria-label="done" /> : <CircleAlert className="mt-0.5 size-4 text-amber-600" aria-label="needs attention" />}
                <div>
                  <div className="font-medium text-slate-800">{o.label}</div>
                  <div className="text-slate-500">{o.label === "Install the pixel" ? <Link className="text-brand-600 hover:underline" href="/pixel">{o.detail}</Link> : o.detail}</div>
                </div>
              </div>
            ))}
            {peak && (
              <div className="mt-3 flex items-start gap-2 rounded-md bg-amber-50 p-2.5 text-sm text-amber-900">
                <CalendarClock className="mt-0.5 size-4 shrink-0" aria-hidden />
                <div>
                  <span className="font-medium">{peak.name}</span> from {formatDate(`${peak.start}T00:00:00+05:30`)}. Clicks cost ~{Math.round((peak.cpcFactor - 1) * 100)}% more. Raise caps and submit creatives early.
                </div>
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Spend" value={formatINR(totals30.spendPaise)} sub="last 30 days" />
        <Stat label="Conversions" value={formatNum(totals30.conversions)} sub={`${formatINR(d30.cpaPaise)} per conversion`} />
        <Stat label="ROAS" value={formatRatio(d30.roas)} sub={`${formatINR(totals30.revenuePaise)} attributed revenue`} />
        <Stat label="North Star" value={`${d30.nsm.toFixed(1)}%`} sub="engaged customers who returned & bought" />
        <Stat
          label="Incremental lift"
          value={pooled.holdoutRate > 0 ? `${pooled.relativeLift >= 0 ? "+" : ""}${(pooled.relativeLift * 100).toFixed(0)}%` : "—"}
          sub={pooled.status === "insufficient_data" ? "not enough data yet" : pooled.significant ? "vs holdout · statistically real" : "vs holdout · inconclusive"}
        />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader title="Spend per day" />
          <CardBody>
            <DailyBars data={series as unknown as Record<string, number | string>[]} dataKey="spend" label="Spend" format="inr" series={0} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Attributed conversions per day" />
          <CardBody>
            <DailyBars data={series as unknown as Record<string, number | string>[]} dataKey="conversions" label="Conversions" series={1} />
          </CardBody>
        </Card>
      </div>

      <div className="mb-6">
        <LiftCard lift={pooled} title="Are your retention ads creating new purchases?" scope="Pooled across campaigns active in the last 30 days: people who saw ads vs your brand-level 10% holdout." />
      </div>

      <Card>
        <CardHeader
          title="Campaign history"
          description="Filter by audience segment or status. Media.net is the only channel in this MVP."
          action={
            <form className="flex flex-wrap gap-2" action="/dashboard">
              <Select name="persona" defaultValue={sp.persona ?? ""} className="h-9 w-48" aria-label="Filter by audience">
                <option value="">All audiences</option>
                {PERSONA_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {getPersona(k).name}
                  </option>
                ))}
              </Select>
              <Select name="status" defaultValue={sp.status ?? ""} className="h-9 w-40" aria-label="Filter by status">
                <option value="">All statuses</option>
                {["live", "scheduled", "paused", "completed", "stopped", "draft", "pending_approval"].map((s) => (
                  <option key={s} value={s}>
                    {s.replace("_", " ")}
                  </option>
                ))}
              </Select>
              <button className="h-9 rounded-md border border-slate-300 px-3 text-sm hover:bg-slate-50">Apply</button>
            </form>
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-2 font-medium">Campaign</th>
                <th className="px-3 py-2 font-medium">Audience</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Spend</th>
                <th className="px-3 py-2 text-right font-medium">Conv.</th>
                <th className="px-3 py-2 text-right font-medium">ROAS</th>
                <th className="px-5 py-2 text-right font-medium">Lift vs holdout</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((c) => {
                const t = totalsByCampaign.get(c.id)!;
                const d = derive(t);
                const l = liftFor(t, c.treatedUsers, c.holdoutUsers);
                return (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-5 py-2.5">
                      <Link href={`/campaigns/${c.id}`} className="font-medium text-slate-900 hover:text-brand-700">
                        {c.name}
                      </Link>
                      <div className="text-xs text-slate-500">
                        {c.code} · {formatDate(c.startAt)} – {formatDate(c.endAt)}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-slate-700">{PERSONAS.find((p) => p.key === c.personaKey)?.name}</td>
                    <td className="px-3 py-2.5">
                      <StatusBadge status={c.status} />
                    </td>
                    <td className="tabular px-3 py-2.5 text-right">{formatINR(t.spendPaise)}</td>
                    <td className="tabular px-3 py-2.5 text-right">{formatNum(t.conversions)}</td>
                    <td className="tabular px-3 py-2.5 text-right">{t.spendPaise ? formatRatio(d.roas) : "—"}</td>
                    <td className="px-5 py-2.5 text-right">
                      {t.spendPaise === 0 ? (
                        <span className="text-slate-400">—</span>
                      ) : l.status === "insufficient_data" ? (
                        <Badge tone="neutral">too early</Badge>
                      ) : (
                        <Badge tone={l.significant ? "green" : "amber"}>
                          {l.relativeLift >= 0 ? "+" : ""}
                          {(l.relativeLift * 100).toFixed(0)}% {l.significant ? "" : "(noise?)"}
                        </Badge>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-6 text-center text-slate-500">
                    No campaigns match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {pixelStatus === "fail" && (
        <Callout tone="red" className="mt-6" title="Pixel issue detected">
          Some events stopped arriving. Audiences and attribution may be undercounted. <Link href="/pixel" className="font-medium underline">See pixel health</Link>
        </Callout>
      )}
    </>
  );
}

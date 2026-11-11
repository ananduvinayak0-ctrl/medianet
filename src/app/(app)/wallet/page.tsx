import { TopUpForm } from "@/components/topup-form";
import { Badge, Card, CardBody, CardHeader, PageHeader, Stat } from "@/components/ui";
import { db } from "@/lib/db";
import { formatDateTime, formatINR } from "@/lib/format";
import { can } from "@/lib/rbac";
import { getSession } from "@/lib/session";
import { walletSummary } from "@/lib/wallet";

export default async function WalletPage() {
  const session = await getSession();
  const [w, ledger] = await Promise.all([
    walletSummary(db, session.workspace.id),
    db.ledgerEntry.findMany({ where: { workspaceId: session.workspace.id }, orderBy: { createdAt: "desc" }, take: 60 }),
  ]);
  const daysLeft = w.dailyBurnPaise > 0 ? w.availablePaise / w.dailyBurnPaise : null;

  return (
    <>
      <PageHeader
        title="Wallet & billing"
        description="Prepaid in INR. Campaigns can never spend more than the wallet holds: delivery is capped channel-side, and live campaigns auto-pause when it runs out. The balance is always computed from the ledger below and never edited directly."
      />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Available to spend" value={formatINR(Math.max(0, w.availablePaise))} sub={daysLeft !== null ? `≈ ${daysLeft.toFixed(1)} days at current pace` : "no live campaigns"} />
        <Stat label="Ledger balance" value={formatINR(w.balancePaise)} sub="reported spend deducted" />
        <Stat label="Not yet reported" value={formatINR(w.inFlightPaise)} sub="delivered; channel reports ~30 min late" />
        <Stat label="Committed" value={formatINR(w.committedPaise)} sub="remaining ceilings of live + scheduled" />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader title="Ledger" description="Most recent 60 entries" />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-2 font-medium">When</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Details</th>
                  <th className="px-5 py-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {ledger.map((l) => (
                  <tr key={l.id}>
                    <td className="whitespace-nowrap px-5 py-2 text-slate-600">{formatDateTime(l.createdAt)}</td>
                    <td className="px-3 py-2">
                      <Badge tone={l.type === "topup" ? "green" : l.type === "spend" ? "neutral" : "amber"}>{l.type}</Badge>
                    </td>
                    <td className="px-3 py-2 text-slate-700">
                      {l.memo}
                      {l.invoiceNo && <span className="ml-1 text-xs text-slate-500">({l.invoiceNo})</span>}
                    </td>
                    <td className={`tabular whitespace-nowrap px-5 py-2 text-right font-medium ${l.amountPaise > 0 ? "text-emerald-700" : "text-slate-800"}`}>
                      {l.amountPaise > 0 ? "+" : "−"}
                      {formatINR(Math.abs(l.amountPaise), { precise: true })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card className="h-fit">
          <CardHeader title="Add money" />
          <CardBody>
            <TopUpForm canTopUp={can(session.role, "wallet:topup")} />
          </CardBody>
        </Card>
      </div>
    </>
  );
}

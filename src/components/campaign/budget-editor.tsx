"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Lock } from "lucide-react";
import { api } from "@/lib/client";
import { formatINR } from "@/lib/format";
import { Button, Callout, Hint, Input, Label } from "../ui";

export function BudgetEditor({
  id,
  dailyPaise,
  lifetimePaise,
  spentPaise,
  canEdit,
  canRaiseCap,
}: {
  id: string;
  dailyPaise: number;
  lifetimePaise: number;
  spentPaise: number;
  canEdit: boolean;
  canRaiseCap: boolean;
}) {
  const router = useRouter();
  const [daily, setDaily] = useState(dailyPaise / 100);
  const [lifetime, setLifetime] = useState(lifetimePaise / 100);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "green" | "red"; text: string } | null>(null);
  const raising = lifetime * 100 > lifetimePaise;
  const blocked = raising && !canRaiseCap;
  const changed = daily * 100 !== dailyPaise || lifetime * 100 !== lifetimePaise;

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await api(`/api/campaigns/${id}/budget`, { body: { dailyBudgetRupees: daily, lifetimeBudgetRupees: lifetime, reason: reason || undefined }, idempotent: true });
      setMsg({ tone: "green", text: "Budget updated and logged in the audit trail." });
      setReason("");
      router.refresh();
    } catch (e) {
      setMsg({ tone: "red", text: e instanceof Error ? e.message : "Failed" });
    } finally {
      setBusy(false);
    }
  }

  if (!canEdit) return <p className="text-sm text-slate-500">Your role can&apos;t change budgets.</p>;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="bd-daily">Daily (₹)</Label>
          <Input id="bd-daily" type="number" min={500} step={100} value={daily} onChange={(e) => setDaily(Number(e.target.value) || 0)} />
        </div>
        <div>
          <Label htmlFor="bd-life">Spend ceiling (₹)</Label>
          <Input id="bd-life" type="number" min={500} step={500} value={lifetime} onChange={(e) => setLifetime(Number(e.target.value) || 0)} />
        </div>
      </div>
      <Hint>Already spent: {formatINR(spentPaise)}. The ceiling can&apos;t go below that.</Hint>
      <div>
        <Label htmlFor="bd-reason">Reason (optional, goes in the audit log)</Label>
        <Input id="bd-reason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="e.g. CPA alert, festive push" />
      </div>
      {blocked && (
        <Callout tone="amber">
          <Lock className="mr-1 inline size-4" aria-hidden />
          Only an Owner or Admin can raise the spend ceiling.
        </Callout>
      )}
      {msg && <Callout tone={msg.tone}>{msg.text}</Callout>}
      <Button size="sm" onClick={save} disabled={busy || !changed || blocked}>
        {busy ? "Saving…" : "Save budget"}
      </Button>
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client";
import { Button, Callout, Hint, Input, Label } from "./ui";

export function TopUpForm({ canTopUp }: { canTopUp: boolean }) {
  const router = useRouter();
  const [amount, setAmount] = useState(25000);
  const [stage, setStage] = useState<"idle" | "checkout" | "busy">("idle");
  const [msg, setMsg] = useState<{ tone: "green" | "red"; text: string } | null>(null);

  if (!canTopUp) return <p className="text-sm text-slate-500">Only the Owner can add money to the wallet.</p>;

  async function pay() {
    setStage("busy");
    setMsg(null);
    try {
      const r = await api<{ invoiceNo: string }>("/api/wallet/topup", { body: { rupees: amount }, idempotent: true });
      setMsg({ tone: "green", text: `Payment received. GST invoice ${r.invoiceNo} issued. Paused campaigns don't resume automatically; resume them when you're ready.` });
      router.refresh();
    } catch (e) {
      setMsg({ tone: "red", text: e instanceof Error ? e.message : "Payment failed" });
    } finally {
      setStage("idle");
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <Label htmlFor="amt">Amount (₹)</Label>
        <Input id="amt" type="number" min={500} max={1000000} step={500} value={amount} onChange={(e) => setAmount(Number(e.target.value) || 0)} />
        <div className="mt-2 flex flex-wrap gap-2">
          {[5000, 25000, 50000, 100000].map((v) => (
            <button key={v} type="button" onClick={() => setAmount(v)} className="rounded-full border border-slate-300 px-3 py-1 text-xs hover:bg-slate-50">
              ₹{v.toLocaleString("en-IN")}
            </button>
          ))}
        </div>
        <Hint>₹500 – ₹10,00,000. GST at 18% is invoiced separately.</Hint>
      </div>
      {stage === "checkout" ? (
        <div className="rounded-md border border-slate-200 p-3 text-sm">
          <div className="font-medium">Razorpay checkout (mock)</div>
          <p className="text-slate-600">Pay ₹{amount.toLocaleString("en-IN")} via UPI / card / netbanking.</p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" onClick={pay}>
              Confirm payment
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setStage("idle")}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button onClick={() => setStage("checkout")} disabled={stage === "busy" || amount < 500 || amount > 1_000_000}>
          {stage === "busy" ? "Processing…" : "Add money"}
        </Button>
      )}
      {msg && <Callout tone={msg.tone}>{msg.text}</Callout>}
    </div>
  );
}

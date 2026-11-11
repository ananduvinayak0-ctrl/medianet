"use client";

import { useState } from "react";
import { ChevronDown, ShieldCheck, Sparkles } from "lucide-react";
import type { BudgetSuggestion } from "@/lib/ai/budget-suggester";
import { formatINR, formatNum, formatRatio } from "@/lib/format";
import { Badge, Button } from "../ui";

/** Explainable AI panel: recommendation + expected range + reasons + guardrails + inputs. */
export function WhyPanel({ suggestion, loading, onAccept, onReject, decision }: { suggestion: BudgetSuggestion | null; loading: boolean; onAccept: () => void; onReject: () => void; decision?: string }) {
  const [open, setOpen] = useState(false);
  if (loading && !suggestion) return <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">Working out a budget suggestion…</div>;
  if (!suggestion) return null;

  if (suggestion.status === "insufficient_data") {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
        <div className="flex items-center gap-2 font-medium text-slate-800">
          <Sparkles className="size-4 text-brand-600" aria-hidden /> Budget Suggester
          <Badge tone="neutral">Not enough data</Badge>
        </div>
        <p className="mt-2 text-slate-600">We don&apos;t show a number when confidence is low. A confident-looking wrong suggestion is worse than none. Start small (₹500–₹1,000/day) and we&apos;ll suggest once results come in.</p>
      </div>
    );
  }

  const [lo, mid, hi] = suggestion.expected.conversions;
  const [rlo, , rhi] = suggestion.expected.roas;
  return (
    <div className="rounded-lg border border-brand-200 bg-brand-50/40 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles className="size-4 text-brand-600" aria-hidden />
        <span className="font-medium text-slate-900">Suggested: {formatINR(suggestion.recommendedDailyPaise)}/day</span>
        <Badge tone={suggestion.confidence === "high" ? "green" : "amber"}>{suggestion.confidence} confidence</Badge>
        {decision && <Badge tone="violet">{decision}</Badge>}
      </div>
      <p className="mt-1 text-sm text-slate-600">
        Expect about <strong>{formatNum(mid)}</strong> conversions (likely {formatNum(lo)}–{formatNum(hi)}) and a ROAS of {formatRatio(rlo, 1)}–{formatRatio(rhi, 1)} over the campaign. Ranges are estimates, not guarantees.
      </p>
      <ul className="mt-3 space-y-1.5 text-sm text-slate-700">
        {suggestion.reasons.map((r) => (
          <li key={r} className="flex gap-2">
            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand-500" aria-hidden />
            <span>{r}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" type="button" onClick={onAccept}>
          Use {formatINR(suggestion.recommendedDailyPaise)}/day
        </Button>
        <Button size="sm" variant="ghost" type="button" onClick={onReject}>
          Ignore suggestion
        </Button>
      </div>
      <button type="button" className="mt-3 flex items-center gap-1 text-sm font-medium text-brand-700" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <ChevronDown className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden /> Why this number? Guardrails & inputs
      </button>
      {open && (
        <div className="mt-2 grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
          <div>
            <div className="mb-1 font-medium text-slate-800">Guardrails (lowest one wins)</div>
            <ul className="space-y-1">
              {suggestion.guardrails.map((g) => (
                <li key={g.label} className="flex items-start gap-2">
                  <ShieldCheck className={`mt-0.5 size-4 shrink-0 ${g.binding ? "text-brand-600" : "text-slate-400"}`} aria-hidden />
                  <span>
                    <span className="font-medium">{g.label}</span>
                    {g.limitPaise !== null && <span className="tabular"> · {formatINR(g.limitPaise)}/day</span>}
                    {g.binding && <Badge tone="violet" className="ml-1">applied</Badge>}
                    <span className="block text-slate-500">{g.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="mb-1 font-medium text-slate-800">Inputs used</div>
            <dl className="space-y-1">
              {suggestion.inputsUsed.map((i) => (
                <div key={i.label} className="flex justify-between gap-3 border-b border-slate-100 pb-1">
                  <dt className="text-slate-500">{i.label}</dt>
                  <dd className="tabular font-medium text-slate-800">{i.value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 text-xs text-slate-500">The suggester never changes your budget. You decide, and your decision is logged in the audit trail.</p>
          </div>
        </div>
      )}
    </div>
  );
}

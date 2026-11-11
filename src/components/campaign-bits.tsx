import type { CampaignStatus } from "@/lib/domain";
import { STATUS_LABEL } from "@/lib/domain";
import { CATALOG } from "@/lib/catalog";
import { getTemplate } from "@/lib/templates";
import { formatPct } from "@/lib/format";
import type { LiftResult } from "@/lib/stats";
import { Badge, Card, CardBody, CardHeader } from "./ui";
import { CheckCircle2, CircleDashed, CirclePause, CircleStop, Clock, Hourglass, Radio } from "lucide-react";

const STATUS_STYLE: Record<CampaignStatus, { tone: "neutral" | "blue" | "green" | "amber" | "red" | "violet"; Icon: typeof Radio }> = {
  draft: { tone: "neutral", Icon: CircleDashed },
  pending_approval: { tone: "violet", Icon: Hourglass },
  scheduled: { tone: "blue", Icon: Clock },
  live: { tone: "green", Icon: Radio },
  paused: { tone: "amber", Icon: CirclePause },
  completed: { tone: "neutral", Icon: CheckCircle2 },
  stopped: { tone: "red", Icon: CircleStop },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLE[status as CampaignStatus] ?? STATUS_STYLE.draft;
  return (
    <Badge tone={s.tone}>
      <s.Icon className="size-3" aria-hidden />
      {STATUS_LABEL[status as CampaignStatus] ?? status}
    </Badge>
  );
}

/** Native-ad preview. Dynamic templates render the shopper's product from the (mock) catalog. */
export function AdPreview({ templateKey, headline, body, cta, offerCode, productIndex = 0 }: { templateKey: string; headline: string; body: string; cta: string; offerCode?: string | null; productIndex?: number }) {
  const t = getTemplate(templateKey);
  const product = CATALOG[productIndex % CATALOG.length];
  const text = body.replace("{product}", t.kind === "dynamic" ? product.name.split(" · ")[0] : "your favourite").replace("{offer}", offerCode || "OFFER");
  const hue = t.kind === "dynamic" ? product.hue : t.hue;
  return (
    <div className="w-full max-w-sm overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="relative flex aspect-[1.91/1] items-end p-3" style={{ background: `linear-gradient(135deg, hsl(${hue} 60% 88%), hsl(${hue} 45% 70%))` }}>
        {t.kind === "dynamic" && (
          <div className="rounded bg-white/90 px-2 py-1 text-xs font-medium text-slate-800 shadow-sm">
            {product.name} · ₹{(product.pricePaise / 100).toLocaleString("en-IN")}
          </div>
        )}
        <span className="absolute right-2 top-2 rounded bg-black/40 px-1.5 text-[10px] uppercase tracking-wide text-white">Sponsored</span>
      </div>
      <div className="space-y-1 p-3">
        <div className="text-xs text-slate-500">Kaapi &amp; Co.</div>
        <div className="font-semibold leading-snug text-slate-900">{headline || "Your headline"}</div>
        <p className="text-sm text-slate-600">{text || "Your description"}</p>
        <div className="pt-1">
          <span className="inline-block rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white">{cta}</span>
        </div>
      </div>
    </div>
  );
}

/** Incremental lift vs the brand-level holdout, in plain language. */
export function LiftCard({ lift, title = "Did the ads actually work?", scope }: { lift: LiftResult; title?: string; scope?: string }) {
  const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(0)}%`;
  return (
    <Card>
      <CardHeader
        title={title}
        description={scope ?? "We compare people who saw ads with a control group that didn't (same segments, fixed for the quarter)."}
        action={
          lift.status === "insufficient_data" ? (
            <Badge tone="neutral">Not enough data yet</Badge>
          ) : lift.significant ? (
            <Badge tone="green">Real lift (95% confidence)</Badge>
          ) : (
            <Badge tone="amber">Inconclusive</Badge>
          )
        }
      />
      <CardBody className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <div className="text-xs text-slate-500">Saw ads: bought</div>
            <div className="tabular text-xl font-semibold">{formatPct(lift.treatedRate)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Holdout: bought anyway</div>
            <div className="tabular text-xl font-semibold">{formatPct(lift.holdoutRate)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Incremental lift</div>
            <div className="tabular text-xl font-semibold">{lift.holdoutRate > 0 ? pct(lift.relativeLift) : "—"}</div>
            {lift.holdoutRate > 0 && (
              <div className="tabular text-xs text-slate-500">
                95% range {pct(lift.ciLow)} to {pct(lift.ciHigh)}
              </div>
            )}
          </div>
        </div>
        <p className="text-sm text-slate-600">
          {lift.status === "insufficient_data"
            ? "We need at least 20 purchases in both groups before we can tell real lift from noise. Keep the campaign running."
            : lift.significant
              ? `About ${Math.round(lift.incrementalConversions)} purchases happened because of the ads, beyond what customers would have done anyway.`
              : "Buyers who saw ads purchased more, but the difference is still within the range of random noise. Don't scale up based on this yet."}
        </p>
      </CardBody>
    </Card>
  );
}

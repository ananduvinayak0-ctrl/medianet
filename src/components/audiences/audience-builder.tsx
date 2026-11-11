"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Archive, ChevronDown, Filter, Save, ShieldCheck, Sparkles, Users } from "lucide-react";
import { api, ApiError, detailLines } from "@/lib/client";
import { MIN_AUDIENCE, type PersonaKey } from "@/lib/domain";
import { formatNum } from "@/lib/format";
import {
  activeFilterCount,
  CHANNEL_LABEL,
  FILTER_GROUPS,
  label,
  LIFECYCLE,
  LIFECYCLE_INFO,
  PURCHASE_CHANNELS,
  SMART_PRESETS,
  TARGETABLE,
  type SegmentDefinition,
  type SegmentFilters,
  type SegmentFunnel,
  type TargetableSegment,
} from "@/lib/segment-defs";
import { Badge, Button, Callout, Card, CardBody, CardHeader, cn, Hint, Input, Label, ProgressBar, Textarea } from "../ui";

export interface BuilderInitial {
  id?: string;
  name: string;
  description: string;
  basedOn: PersonaKey | null;
  def: SegmentDefinition;
}

const PERIOD_PRESETS = [
  { p1: 30, p2: 60, label: "Monthly (30 / 60 days)" },
  { p1: 90, p2: 270, label: "Quarter / rest of year (90 / 270)" },
  { p1: 180, p2: 180, label: "Half-years (180 / 180)" },
];

const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : "0%");

export function AudienceBuilder({ initial, initialFunnel, canEdit }: { initial: BuilderInitial; initialFunnel: SegmentFunnel; canEdit: boolean }) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [basedOn, setBasedOn] = useState<PersonaKey | null>(initial.basedOn);
  const [def, setDef] = useState<SegmentDefinition>(initial.def);
  const [funnel, setFunnel] = useState<SegmentFunnel>(initialFunnel);
  const [loading, setLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ message: string; lines: string[] } | null>(null);
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set(FILTER_GROUPS.filter((g) => g.fields.some((f) => initial.def.filters[f.key].length)).map((g) => g.title)));
  const first = useRef(true);

  // Live preview: debounced, cancelled when the definition changes again.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (def.segments.length === 0) return;
    const ctl = { cancelled: false };
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const f = await api<SegmentFunnel>("/api/audiences/preview", { body: { definition: def } });
        if (!ctl.cancelled) {
          setFunnel(f);
          setPreviewError(null);
        }
      } catch (e) {
        if (!ctl.cancelled) setPreviewError(e instanceof Error ? e.message : "Preview failed");
      } finally {
        if (!ctl.cancelled) setLoading(false);
      }
    }, 400);
    return () => {
      ctl.cancelled = true;
      clearTimeout(t);
    };
  }, [def]);

  const patch = (p: Partial<SegmentDefinition>) => setDef((d) => ({ ...d, ...p }));
  const toggleSegment = (s: TargetableSegment) => patch({ segments: def.segments.includes(s) ? def.segments.filter((x) => x !== s) : TARGETABLE.filter((x) => x === s || def.segments.includes(x)) });
  const toggleFilter = (key: keyof SegmentFilters, v: string) =>
    setDef((d) => {
      const cur = d.filters[key] as string[];
      return { ...d, filters: { ...d.filters, [key]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] } };
    });
  const applyPreset = (k: PersonaKey) => {
    const p = SMART_PRESETS[k];
    setDef(p.def);
    setBasedOn(k);
    if (!name.trim()) setName(p.name);
    setOpenGroups(new Set(FILTER_GROUPS.filter((g) => g.fields.some((f) => p.def.filters[f.key].length)).map((g) => g.title)));
  };

  const s = funnel.selected;
  const contactableOk = s.contactable + s.control >= MIN_AUDIENCE;
  const filterCount = activeFilterCount(def.filters);

  async function save() {
    setSaving(true);
    setError(null);
    const body = { name, description, basedOn, definition: def };
    try {
      const p = initial.id
        ? await api<{ id: string }>(`/api/audiences/custom/${initial.id}`, { method: "PUT", body, idempotent: true })
        : await api<{ id: string }>("/api/audiences/custom", { body, idempotent: true });
      router.push(`/audiences/${p.id}`);
      router.refresh();
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : "Couldn't save", lines: e instanceof ApiError ? detailLines(e.details) : [] });
      setSaving(false);
    }
  }

  async function archive() {
    if (!initial.id || !confirm("Archive this audience? Campaigns that used it keep their results.")) return;
    await api(`/api/audiences/custom/${initial.id}`, { method: "DELETE" });
    router.push("/audiences");
    router.refresh();
  }

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_320px]">
      <div className="min-w-0 space-y-4">
        {!initial.id && (
          <Card>
            <CardBody className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                <Sparkles className="size-4 text-brand-600" aria-hidden /> Start from a Smart Persona (optional)
              </div>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(SMART_PRESETS) as PersonaKey[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => applyPreset(k)}
                    className={cn("rounded-full border px-3 py-1 text-xs", basedOn === k ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-300 text-slate-700 hover:bg-slate-50")}
                  >
                    {SMART_PRESETS[k].name}
                  </button>
                ))}
              </div>
              <Hint className="mt-0">Presets fill in the rules below. You can change anything afterwards.</Hint>
            </CardBody>
          </Card>
        )}

        {/* Rule 1 */}
        <Card>
          <CardHeader title="1. Who's eligible" description="Customers with a valid, unique customer ID who bought through the channel this campaign is aimed at." />
          <CardBody className="space-y-4">
            <div>
              <Label>Purchase channel</Label>
              <div className="flex flex-wrap gap-2">
                {PURCHASE_CHANNELS.map((c) => (
                  <Button key={c} type="button" size="sm" variant={def.channel === c ? "primary" : "secondary"} onClick={() => patch({ channel: c })} aria-pressed={def.channel === c}>
                    {CHANNEL_LABEL[c]}
                  </Button>
                ))}
              </div>
              <Hint>Counts purchases at this brand or at other brands in the group.</Hint>
            </div>
            <FunnelList
              rows={[
                { label: "All profiles", n: funnel.profiles },
                { label: "No valid customer ID (anonymous visitors, invalid records)", n: -funnel.noCustomerId },
                { label: `Never bought ${def.channel === "any" ? "online or in store" : CHANNEL_LABEL[def.channel].toLowerCase()}`, n: -funnel.otherChannel },
                { label: "Eligible customers", n: funnel.eligible, strong: true },
              ]}
            />
          </CardBody>
        </Card>

        {/* Rule 2 */}
        <Card>
          <CardHeader title="2. Lifecycle segment" description="Checked in order; each customer gets the first segment that matches, so everyone is in exactly one." />
          <CardBody className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <Label htmlFor="p1">P1: last … days</Label>
                <Input id="p1" type="number" min={7} max={365} value={def.p1Days} onChange={(e) => patch({ p1Days: Math.max(7, Math.min(365, Number(e.target.value) || 7)) })} />
              </div>
              <div>
                <Label htmlFor="p2">P2: the … days before P1</Label>
                <Input id="p2" type="number" min={7} max={730} value={def.p2Days} onChange={(e) => patch({ p2Days: Math.max(7, Math.min(730, Number(e.target.value) || 7)) })} />
              </div>
              <div>
                <Label>Quick set</Label>
                <div className="flex flex-wrap gap-1">
                  {PERIOD_PRESETS.map((p) => (
                    <button key={p.label} type="button" onClick={() => patch({ p1Days: p.p1, p2Days: p.p2 })} className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50">
                      {p.p1}/{p.p2}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-1.5 font-medium">Target?</th>
                  <th className="py-1.5 font-medium">Segment</th>
                  <th className="py-1.5 text-right font-medium">Customers</th>
                  <th className="w-32 py-1.5 pl-3 font-medium">Share</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {LIFECYCLE.map((seg, i) => {
                  const n = funnel.distribution[seg];
                  const targetable = seg !== "out_of_scope";
                  return (
                    <tr key={seg}>
                      <td className="py-2">
                        {targetable ? (
                          <input
                            type="checkbox"
                            className="size-4 accent-brand-600"
                            checked={def.segments.includes(seg as TargetableSegment)}
                            onChange={() => toggleSegment(seg as TargetableSegment)}
                            aria-label={`Target ${LIFECYCLE_INFO[seg].label}`}
                          />
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-2">
                        <div className="font-medium text-slate-900">
                          {i + 1}. {LIFECYCLE_INFO[seg].label}
                        </div>
                        <div className="text-xs text-slate-500">{LIFECYCLE_INFO[seg].rule}</div>
                      </td>
                      <td className="tabular py-2 text-right font-semibold">{formatNum(n)}</td>
                      <td className="py-2 pl-3">
                        <ProgressBar value={n} max={funnel.eligible} tone={targetable ? "blue" : "amber"} label={`${LIFECYCLE_INFO[seg].label} share`} />
                        <div className="tabular text-xs text-slate-500">{pct(n, funnel.eligible)}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {def.segments.length === 0 && <p className="text-sm text-red-600">Pick at least one segment to target.</p>}
          </CardBody>
        </Card>

        {/* Rule 5 */}
        <Card>
          <CardHeader
            title={
              <span className="inline-flex items-center gap-2">
                3. Narrow further <Badge tone="neutral">optional</Badge>
              </span>
            }
            description="Only if the offer needs it. Applied to target and control alike, so the comparison stays fair."
            action={filterCount > 0 ? <Badge tone="blue"><Filter className="size-3" aria-hidden /> {filterCount} active</Badge> : undefined}
          />
          <div className="divide-y divide-slate-100">
            {FILTER_GROUPS.map((g) => {
              const open = openGroups.has(g.title);
              const n = g.fields.reduce((a, f) => a + def.filters[f.key].length, 0);
              return (
                <div key={g.title}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between px-5 py-3 text-left hover:bg-slate-50"
                    aria-expanded={open}
                    onClick={() =>
                      setOpenGroups((s) => {
                        const next = new Set(s);
                        if (open) next.delete(g.title);
                        else next.add(g.title);
                        return next;
                      })
                    }
                  >
                    <span>
                      <span className="text-sm font-medium text-slate-900">{g.title}</span>
                      {n > 0 && <span className="ml-2 text-xs text-brand-700">{n} selected</span>}
                      <span className="block text-xs text-slate-500">{g.hint}</span>
                    </span>
                    <ChevronDown className={cn("size-4 text-slate-400 transition-transform", open && "rotate-180")} aria-hidden />
                  </button>
                  {open && (
                    <div className="space-y-3 px-5 pb-4">
                      {g.fields.map((f) => (
                        <div key={f.key}>
                          {g.fields.length > 1 && <div className="mb-1 text-xs font-medium text-slate-600">{f.label}</div>}
                          <div className="flex flex-wrap gap-1.5">
                            {f.options.map((o) => {
                              const on = (def.filters[f.key] as string[]).includes(o);
                              return (
                                <button
                                  key={o}
                                  type="button"
                                  onClick={() => toggleFilter(f.key, o)}
                                  aria-pressed={on}
                                  className={cn("rounded-full border px-2.5 py-1 text-xs", on ? "border-brand-500 bg-brand-50 font-medium text-brand-700" : "border-slate-300 text-slate-700 hover:bg-slate-50")}
                                >
                                  {label(o)}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>

        {/* Rule 3 */}
        <Card>
          <CardHeader
            title="4. Target and control groups"
            description={`Random split within each segment, stratified by lifecycle × value tier × channel. ${funnel.controlPct}% control, fixed for ${funnel.controlPeriod ?? "this quarter"}.`}
          />
          <CardBody>
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-1.5 font-medium">Segment</th>
                  <th className="py-1.5 text-right font-medium">Matching</th>
                  <th className="py-1.5 text-right font-medium">Target</th>
                  <th className="py-1.5 text-right font-medium">Control</th>
                  <th className="py-1.5 text-right font-medium">Control share</th>
                </tr>
              </thead>
              <tbody className="tabular divide-y divide-slate-100">
                {def.segments.map((seg) => {
                  const g = funnel.perSegment[seg];
                  return (
                    <tr key={seg}>
                      <td className="py-2 font-medium text-slate-900">{LIFECYCLE_INFO[seg].label}</td>
                      <td className="py-2 text-right">{formatNum(g.matching)}</td>
                      <td className="py-2 text-right">{formatNum(g.target)}</td>
                      <td className="py-2 text-right">{formatNum(g.controlRaw)}</td>
                      <td className="py-2 text-right">{pct(g.controlRaw, g.matching)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Hint>The control group isn&apos;t contacted by any campaign this quarter, so every campaign can be compared fairly against it.</Hint>
          </CardBody>
        </Card>

        {/* Rule 4 */}
        <Card>
          <CardHeader title="5. Who we can contact" description="Only the target group is contacted. Before sending, we remove people who mustn't be contacted." />
          <CardBody>
            <FunnelList
              rows={[
                { label: "Target group", n: s.target },
                { label: "On the global do-not-contact list", n: -s.doNotContact },
                { label: "Opted out of ads on this channel, or withdrew consent", n: -s.optedOut },
                { label: "Not reachable on Media.net (no identity match)", n: -s.unreachable },
                { label: "Will be contacted", n: s.contactable, strong: true },
              ]}
            />
          </CardBody>
        </Card>

        {/* Rule 6 */}
        <Card>
          <CardHeader title="6. How results are measured" />
          <CardBody className="space-y-2 text-sm text-slate-700">
            <p>
              Every campaign on this audience compares the <strong>{formatNum(s.contactable)}</strong> contacted people with a control group of <strong>{formatNum(s.control)}</strong> comparable people
              (same segments and filters, same exclusions) who aren&apos;t contacted. The difference in purchases is the campaign&apos;s real effect.
            </p>
            <p className="text-slate-500">Results from past campaigns appear on this audience&apos;s page, so you can use them to plan the next one.</p>
          </CardBody>
        </Card>
      </div>

      {/* Summary */}
      <div className="space-y-4 xl:sticky xl:top-20 xl:self-start">
        <Card>
          <CardBody className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
                <Users className="size-4 text-brand-600" aria-hidden /> Audience size
              </span>
              {loading && <span className="text-xs text-slate-500">Updating…</span>}
            </div>
            <div className="tabular grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-slate-500">Will be contacted</div>
                <div className="text-2xl font-semibold text-slate-900">{formatNum(s.contactable)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Control</div>
                <div className="text-2xl font-semibold text-slate-900">{formatNum(s.control)}</div>
              </div>
            </div>
            {previewError && <p className="text-sm text-red-600">{previewError}</p>}
            {contactableOk ? (
              <p className="flex items-start gap-1.5 text-xs text-emerald-700">
                <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden /> Large enough to launch a campaign.
              </p>
            ) : (
              <Callout tone="amber">Below the {formatNum(MIN_AUDIENCE)}-person minimum to launch. Widen the segments, periods or filters.</Callout>
            )}
            <div>
              <Label htmlFor="aname">Audience name</Label>
              <Input id="aname" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="e.g. Lapsed online regulars" />
            </div>
            <div>
              <Label htmlFor="adesc">Notes (optional)</Label>
              <Textarea id="adesc" rows={2} maxLength={280} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Who is this for, and why?" />
            </div>
            {error && (
              <Callout tone="red" title={error.message}>
                {error.lines.length > 0 && (
                  <ul className="list-disc pl-5">
                    {error.lines.map((l) => (
                      <li key={l}>{l}</li>
                    ))}
                  </ul>
                )}
              </Callout>
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={save} disabled={!canEdit || saving || name.trim().length < 3 || def.segments.length === 0}>
                <Save className="size-4" aria-hidden /> {saving ? "Saving…" : initial.id ? "Save changes" : "Save audience"}
              </Button>
              {initial.id && canEdit && (
                <Button type="button" variant="ghost" onClick={archive}>
                  <Archive className="size-4" aria-hidden /> Archive
                </Button>
              )}
            </div>
            {!canEdit && <Hint className="mt-0">Your role can view audiences but not change them.</Hint>}
            {initial.id && <Hint className="mt-0">Edits apply to new launches. Running campaigns keep the audience they launched with.</Hint>}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function FunnelList({ rows }: { rows: { label: string; n: number; strong?: boolean }[] }) {
  return (
    <ul className="tabular space-y-1 text-sm">
      {rows.map((r) => (
        <li key={r.label} className={cn("flex justify-between gap-3", r.strong ? "border-t border-slate-200 pt-1.5 font-semibold text-slate-900" : r.n < 0 ? "text-slate-500" : "text-slate-700")}>
          <span>{r.label}</span>
          <span>{r.n < 0 ? `−${formatNum(-r.n)}` : formatNum(r.n)}</span>
        </li>
      ))}
    </ul>
  );
}

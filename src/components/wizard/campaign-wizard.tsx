"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, Check, CheckCircle2, Lock, RefreshCw, ShieldCheck, Target, Undo2, Users, XCircle } from "lucide-react";
import type { BudgetSuggestion } from "@/lib/ai/budget-suggester";
import { peaksOverlapping } from "@/lib/calendar";
import { api, ApiError, detailLines } from "@/lib/client";
import { MIN_AUDIENCE, type Objective, type PersonaKey } from "@/lib/domain";
import { formatDateTime, formatINR, formatNum } from "@/lib/format";
import type { AudienceStats } from "@/lib/personas";
import { PERSONAS } from "@/lib/personas";
import { checkCreative, LIMITS } from "@/lib/policy";
import { APPROVAL_THRESHOLD_PAISE } from "@/lib/rbac";
import { ALLOWED_CTAS, getTemplate, TEMPLATES } from "@/lib/templates";
import { AdPreview } from "../campaign-bits";
import { Badge, Button, Callout, Card, CardBody, cn, Hint, Input, Label, Select, Textarea } from "../ui";
import { WhyPanel } from "./why-panel";

export interface WizardInitial {
  draftId?: string;
  name: string;
  description: string;
  objective: Objective;
  personaKey: PersonaKey;
  templateKey: string;
  headline: string;
  body: string;
  cta: string;
  landingUrl: string;
  offerCode: string;
  dailyBudgetRupees: number;
  startImmediately: boolean;
  startAt: string; // ISO
  durationDays: number;
  freqCapDay: number;
  freqCapWeek: number;
}

const STEPS = ["Goal", "Audience", "Budget & schedule", "Creative", "Review & launch"] as const;
const DAY = 86_400_000;
const IST = 330 * 60_000;
const toIstInput = (iso: string) => new Date(new Date(iso).getTime() + IST).toISOString().slice(0, 16);
const fromIstInput = (s: string) => new Date(`${s}:00+05:30`).toISOString();

export function CampaignWizard(props: {
  initial: WizardInitial;
  audience: Record<PersonaKey, AudienceStats>;
  walletAvailablePaise: number;
  simNow: string;
  canCreate: boolean;
  canLaunch: boolean;
  approvalRole: boolean;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [f, setF] = useState(props.initial);
  const set = <K extends keyof WizardInitial>(k: K, v: WizardInitial[K]) => setF((s) => ({ ...s, [k]: v }));

  const [suggestion, setSuggestion] = useState<BudgetSuggestion | null>(null);
  const [suggestionId, setSuggestionId] = useState<string>();
  const [decision, setDecision] = useState<"accepted" | "edited" | "rejected">();
  const [sugLoading, setSugLoading] = useState(false);
  const [submitting, setSubmitting] = useState<"draft" | "launch" | null>(null);
  const [error, setError] = useState<{ message: string; lines: string[] } | null>(null);

  const startIso = f.startImmediately ? props.simNow : f.startAt;
  const endIso = new Date(new Date(startIso).getTime() + f.durationDays * DAY).toISOString();
  const lifetimeRupees = f.dailyBudgetRupees * f.durationDays;
  const stats = props.audience[f.personaKey];
  const template = getTemplate(f.templateKey);
  const policy = useMemo(() => checkCreative(f), [f]);
  const peaks = peaksOverlapping(startIso.slice(0, 10), endIso.slice(0, 10));
  const walletShort = props.walletAvailablePaise < f.dailyBudgetRupees * 100;
  const needsApproval = props.approvalRole && lifetimeRupees * 100 > APPROVAL_THRESHOLD_PAISE;

  const fetchSuggestion = useCallback(async () => {
    setSugLoading(true);
    try {
      const r = await api<{ id: string; suggestion: BudgetSuggestion }>("/api/suggestions/budget", {
        body: { personaKey: f.personaKey, startAt: startIso, endAt: endIso, freqCapDay: f.freqCapDay },
      });
      setSuggestion(r.suggestion);
      setSuggestionId(r.id);
      setDecision(undefined);
    } catch {
      setSuggestion(null);
    } finally {
      setSugLoading(false);
    }
    // startIso changes every render when "start immediately" is on; key the fetch on stable inputs instead
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.personaKey, f.durationDays, f.freqCapDay, f.startImmediately, f.startAt]);

  useEffect(() => {
    if (step === 2) fetchSuggestion();
  }, [step, fetchSuggestion]);

  const chooseObjective = (o: Objective) => {
    const first = PERSONAS.find((p) => p.objective === o)!;
    setF((s) => (s.objective === o ? s : { ...s, objective: o, personaKey: first.key }));
  };

  const choosePersona = (k: PersonaKey) => {
    const rec = TEMPLATES.find((t) => t.recommendedFor.includes(k));
    setF((s) => ({ ...s, personaKey: k, ...(rec && s.templateKey !== rec.key ? { templateKey: rec.key, headline: rec.headline, body: rec.body, cta: rec.cta } : {}) }));
  };

  const chooseTemplate = (key: string) => {
    const t = getTemplate(key);
    setF((s) => ({ ...s, templateKey: key, headline: t.headline, body: t.body, cta: t.cta }));
  };

  const stepValid = [
    f.name.trim().length >= 3,
    stats.eligible >= MIN_AUDIENCE,
    f.dailyBudgetRupees >= 500 && f.durationDays >= 1 && f.durationDays <= 90 && f.freqCapWeek >= f.freqCapDay,
    policy.ok,
    true,
  ];

  async function submit(launch: boolean) {
    setSubmitting(launch ? "launch" : "draft");
    setError(null);
    const campaign = {
      name: f.name,
      description: f.description,
      objective: f.objective,
      personaKey: f.personaKey,
      templateKey: f.templateKey,
      headline: f.headline,
      body: f.body.replace("{offer}", f.offerCode || "{offer}"),
      cta: f.cta,
      landingUrl: f.landingUrl,
      offerCode: f.offerCode || undefined,
      dailyBudgetRupees: f.dailyBudgetRupees,
      lifetimeBudgetRupees: lifetimeRupees,
      startAt: startIso,
      endAt: endIso,
      freqCapDay: f.freqCapDay,
      freqCapWeek: f.freqCapWeek,
      suggestionId,
      suggestionDecision: suggestionId ? (decision ?? "rejected") : undefined,
    };
    try {
      const c = f.draftId
        ? await api<{ id: string }>(`/api/campaigns/${f.draftId}`, { method: "PUT", body: { campaign, launch }, idempotent: true })
        : await api<{ id: string }>("/api/campaigns", { body: { campaign, launch }, idempotent: true });
      router.push(`/campaigns/${c.id}`);
      router.refresh();
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : "Something went wrong", lines: e instanceof ApiError ? detailLines(e.details) : [] });
      setSubmitting(null);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_1fr]">
      <ol className="flex gap-2 overflow-x-auto lg:flex-col" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s}>
            <button
              type="button"
              onClick={() => i <= step || stepValid.slice(0, i).every(Boolean) ? setStep(i) : undefined}
              className={cn(
                "flex w-full items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-left text-sm",
                i === step ? "bg-brand-50 font-medium text-brand-700" : "text-slate-600 hover:bg-slate-100",
              )}
              aria-current={i === step ? "step" : undefined}
            >
              <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full text-xs", i < step ? "bg-brand-600 text-white" : i === step ? "border-2 border-brand-600 text-brand-700" : "border border-slate-300 text-slate-500")}>
                {i < step ? <Check className="size-3.5" aria-hidden /> : i + 1}
              </span>
              {s}
            </button>
          </li>
        ))}
      </ol>

      <div className="min-w-0 space-y-4">
        {!props.canCreate && (
          <Callout tone="amber" title="View-only role">
            Viewers can explore the wizard but can&apos;t save or launch. Switch role in the top bar to try it.
          </Callout>
        )}

        {step === 0 && (
          <Card>
            <CardBody className="space-y-5">
              <div>
                <div className="mb-2 text-sm font-medium text-slate-700">What do you want to achieve?</div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {(
                    [
                      { o: "retarget", title: "Bring shoppers back to finish buying", sub: "Retarget cart abandoners and repeat product viewers.", Icon: Target },
                      { o: "reactivate", title: "Get past customers to buy again", sub: "Reactivate lapsed buyers, cross-sell, reward VIPs.", Icon: Undo2 },
                    ] as const
                  ).map(({ o, title, sub, Icon }) => (
                    <button
                      key={o}
                      type="button"
                      onClick={() => chooseObjective(o)}
                      className={cn("rounded-lg border p-4 text-left", f.objective === o ? "border-brand-500 bg-brand-50 ring-2 ring-brand-100" : "border-slate-200 hover:border-slate-300")}
                      aria-pressed={f.objective === o}
                    >
                      <Icon className="mb-2 size-5 text-brand-600" aria-hidden />
                      <div className="font-medium text-slate-900">{title}</div>
                      <div className="mt-0.5 text-sm text-slate-600">{sub}</div>
                    </button>
                  ))}
                </div>
                <Hint>New-customer acquisition isn&apos;t in this MVP. The product focuses on retention.</Hint>
              </div>
              <div>
                <Label htmlFor="name">Campaign name</Label>
                <Input id="name" value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Black Friday cart recovery" maxLength={80} />
              </div>
              <div>
                <Label htmlFor="desc">Notes (optional)</Label>
                <Textarea id="desc" rows={2} value={f.description} onChange={(e) => set("description", e.target.value)} maxLength={280} placeholder="What's this campaign for? Only your team sees this." />
              </div>
            </CardBody>
          </Card>
        )}

        {step === 1 && (
          <div className="space-y-3">
            {PERSONAS.filter((p) => p.objective === f.objective).map((p) => {
              const s = props.audience[p.key];
              const tooSmall = s.eligible < MIN_AUDIENCE;
              const selected = f.personaKey === p.key;
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => choosePersona(p.key)}
                  className={cn("w-full rounded-lg border bg-white p-4 text-left", selected ? "border-brand-500 ring-2 ring-brand-100" : "border-slate-200 hover:border-slate-300")}
                  aria-pressed={selected}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Users className="size-4 text-brand-600" aria-hidden />
                    <span className="font-medium text-slate-900">{p.name}</span>
                    <Badge tone="blue">Smart Persona</Badge>
                    {tooSmall && <Badge tone="red">Too small to launch</Badge>}
                  </div>
                  <p className="mt-1 text-sm text-slate-700">{p.definition}</p>
                  <p className="text-sm text-slate-500">{p.why}</p>
                  <div className="tabular mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                    <div>
                      <div className="text-xs text-slate-500">Will see ads</div>
                      <div className="font-semibold">{formatNum(s.treated)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">Holdout (no ads)</div>
                      <div className="font-semibold">{formatNum(s.holdout)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">Not reachable</div>
                      <div className="font-semibold">{formatNum(s.unmatched)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">Excluded</div>
                      <div className="font-semibold">{formatNum(s.consentWithdrawn + s.recentBuyersExcluded)}</div>
                    </div>
                  </div>
                  {selected && (
                    <p className="mt-2 text-xs text-slate-500">
                      Excluded: {formatNum(s.consentWithdrawn)} withdrew consent
                      {p.excludesRecentBuyers ? `, ${formatNum(s.recentBuyersExcluded)} bought in the last 30 days (so we don't advertise what they just bought)` : ""}. Holdout stays the same across all your campaigns, so lift numbers stay honest.
                    </p>
                  )}
                </button>
              );
            })}
            {stats.eligible < MIN_AUDIENCE && (
              <Callout tone="red" title={`This audience is below ${formatNum(MIN_AUDIENCE)} reachable people`}>
                Results from tiny audiences are mostly noise, so we block launch. Pick a larger segment or wait for more traffic.
              </Callout>
            )}
          </div>
        )}

        {step === 2 && (
          <>
            <Card>
              <CardBody className="space-y-5">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <Label>When should it start?</Label>
                    <div className="flex gap-2">
                      <Button type="button" size="sm" variant={f.startImmediately ? "primary" : "secondary"} onClick={() => set("startImmediately", true)}>
                        Right after launch
                      </Button>
                      <Button type="button" size="sm" variant={!f.startImmediately ? "primary" : "secondary"} onClick={() => set("startImmediately", false)}>
                        Schedule
                      </Button>
                    </div>
                    {!f.startImmediately && (
                      <div className="mt-2">
                        <Input type="datetime-local" aria-label="Start date and time (IST)" value={toIstInput(f.startAt)} onChange={(e) => e.target.value && set("startAt", fromIstInput(e.target.value))} />
                        <Hint>Times are India Standard Time.</Hint>
                      </div>
                    )}
                  </div>
                  <div>
                    <Label htmlFor="dur">Run for (days)</Label>
                    <Input id="dur" type="number" min={1} max={90} value={f.durationDays} onChange={(e) => set("durationDays", Math.max(1, Math.min(90, Number(e.target.value) || 1)))} />
                    <Hint>Ends {formatDateTime(endIso)}</Hint>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="fcd">Frequency cap: ads per person per day</Label>
                    <Input id="fcd" type="number" min={1} max={10} value={f.freqCapDay} onChange={(e) => set("freqCapDay", Math.max(1, Math.min(10, Number(e.target.value) || 1)))} />
                    <Hint>Too low loses reach; too high causes ad fatigue. Clicking resets the count.</Hint>
                  </div>
                  <div>
                    <Label htmlFor="fcw">…and per week</Label>
                    <Input id="fcw" type="number" min={1} max={50} value={f.freqCapWeek} onChange={(e) => set("freqCapWeek", Math.max(1, Math.min(50, Number(e.target.value) || 1)))} />
                    {f.freqCapWeek < f.freqCapDay && <p className="mt-1 text-xs text-red-600">Weekly cap must be at least the daily cap.</p>}
                  </div>
                </div>

                <div>
                  <Label htmlFor="daily">Daily budget (₹)</Label>
                  <Input
                    id="daily"
                    type="number"
                    min={500}
                    step={100}
                    value={f.dailyBudgetRupees}
                    onChange={(e) => {
                      set("dailyBudgetRupees", Math.max(0, Number(e.target.value) || 0));
                      if (suggestion && decision === "accepted") setDecision("edited");
                    }}
                  />
                  {f.dailyBudgetRupees < 500 && <p className="mt-1 text-xs text-red-600">Minimum is ₹500/day so the campaign can learn.</p>}
                  <div className="mt-2 rounded-md bg-slate-50 p-3 text-sm text-slate-700">
                    <ShieldCheck className="mr-1 inline size-4 text-emerald-600" aria-hidden />
                    <strong>Hard spend ceiling: {formatINR(lifetimeRupees * 100)}</strong> ({formatINR(f.dailyBudgetRupees * 100)} × {f.durationDays} days). You will never spend more than this or more than your wallet balance ({formatINR(Math.max(0, props.walletAvailablePaise))}). Only an Owner or Admin can raise the cap later.
                  </div>
                </div>
              </CardBody>
            </Card>

            {peaks.length > 0 && (
              <Callout tone="amber" title={`Peak season: ${peaks.map((p) => p.name).join(", ")}`}>
                <CalendarClock className="mr-1 inline size-4" aria-hidden />
                Clicks cost more and convert better in peaks. Set your cap now, because creative review queues get long close to sale days.
              </Callout>
            )}

            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">AI budget suggestion</span>
              <Button type="button" size="sm" variant="ghost" onClick={fetchSuggestion} disabled={sugLoading}>
                <RefreshCw className={cn("size-3.5", sugLoading && "animate-spin")} aria-hidden /> Refresh
              </Button>
            </div>
            <WhyPanel
              suggestion={suggestion}
              loading={sugLoading}
              decision={decision}
              onAccept={() => {
                if (!suggestion) return;
                set("dailyBudgetRupees", suggestion.recommendedDailyPaise / 100);
                setDecision("accepted");
              }}
              onReject={() => setDecision("rejected")}
            />
          </>
        )}

        {step === 3 && (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_360px]">
            <Card>
              <CardBody className="space-y-4">
                <div>
                  <Label htmlFor="tpl">Template</Label>
                  <Select id="tpl" value={f.templateKey} onChange={(e) => chooseTemplate(e.target.value)}>
                    {[...TEMPLATES]
                      .sort((a, b) => Number(b.recommendedFor.includes(f.personaKey)) - Number(a.recommendedFor.includes(f.personaKey)))
                      .map((t) => (
                        <option key={t.key} value={t.key}>
                          {t.name}
                          {t.recommendedFor.includes(f.personaKey) ? " (recommended)" : ""}
                        </option>
                      ))}
                  </Select>
                  {template.kind === "dynamic" && <Hint>Dynamic ad: each shopper sees the exact product they viewed or left in cart, from your Shopify catalog. {"{product}"} is filled in automatically.</Hint>}
                </div>
                <div>
                  <Label htmlFor="hl">Headline</Label>
                  <Input id="hl" value={f.headline} onChange={(e) => set("headline", e.target.value)} />
                  <Hint className={f.headline.length > LIMITS.headline ? "text-red-600" : ""}>
                    {f.headline.length}/{LIMITS.headline}
                  </Hint>
                </div>
                <div>
                  <Label htmlFor="bd">Description</Label>
                  <Textarea id="bd" rows={2} value={f.body} onChange={(e) => set("body", e.target.value)} />
                  <Hint className={f.body.length > LIMITS.body ? "text-red-600" : ""}>
                    {f.body.length}/{LIMITS.body}
                  </Hint>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="cta">Button</Label>
                    <Select id="cta" value={f.cta} onChange={(e) => set("cta", e.target.value)}>
                      {ALLOWED_CTAS.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="offer">Offer code (optional)</Label>
                    <Input id="offer" value={f.offerCode} onChange={(e) => set("offerCode", e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} placeholder="COMEBACK15" maxLength={20} />
                    <Hint>We track redemptions in your store to measure the offer&apos;s effect.</Hint>
                  </div>
                </div>
                <div>
                  <Label htmlFor="url">Landing page</Label>
                  <Input id="url" value={f.landingUrl} onChange={(e) => set("landingUrl", e.target.value)} />
                </div>
                <PolicyBox policy={policy} />
              </CardBody>
            </Card>
            <div className="space-y-2">
              <div className="text-sm font-medium text-slate-700">Preview</div>
              <AdPreview templateKey={f.templateKey} headline={f.headline} body={f.body} cta={f.cta} offerCode={f.offerCode} />
              <p className="text-xs text-slate-500">Also rendered as {template.formats.join(", ")}.</p>
            </div>
          </div>
        )}

        {step === 4 && (
          <Card>
            <CardBody className="space-y-5">
              <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                <Row k="Campaign" v={f.name} />
                <Row k="Audience" v={`${PERSONAS.find((p) => p.key === f.personaKey)?.name}: ${formatNum(stats.treated)} people (+${formatNum(stats.holdout)} holdout)`} />
                <Row k="Schedule" v={`${f.startImmediately ? "Starts on launch" : formatDateTime(startIso)} → ${formatDateTime(endIso)}`} />
                <Row k="Budget" v={`${formatINR(f.dailyBudgetRupees * 100)}/day · ceiling ${formatINR(lifetimeRupees * 100)}`} />
                <Row k="Frequency cap" v={`${f.freqCapDay}/day · ${f.freqCapWeek}/week`} />
                <Row k="Creative" v={`${template.name}${f.offerCode ? ` · code ${f.offerCode}` : ""}`} />
                <Row k="AI suggestion" v={suggestion ? (decision ?? "shown, not used") : "not requested"} />
                <Row k="Channel" v="Media.net network (mock adapter)" />
              </dl>
              <ul className="space-y-2 text-sm">
                <Check2 ok={stats.eligible >= MIN_AUDIENCE} text={`Audience has at least ${formatNum(MIN_AUDIENCE)} reachable people`} />
                <Check2 ok={policy.ok} text={policy.ok ? "Creative passes automated policy checks" : `Creative has ${policy.errors.length} policy issue(s). Fix them in step 4.`} />
                <Check2 ok={!walletShort} text={walletShort ? "Wallet covers less than one day of budget. Top up before launching." : "Wallet covers at least one day of budget"} />
                <Check2 ok text="10% brand holdout applied, so we can show real incremental lift" />
                {needsApproval && <Check2 warn text={`Lifetime budget is above ${formatINR(APPROVAL_THRESHOLD_PAISE)}. As an Editor, this goes to an Owner/Admin for approval.`} />}
                {peaks.length > 0 && <Check2 warn text={`Overlaps ${peaks[0].name}. Expect higher click costs.`} />}
              </ul>
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
                <Button type="button" onClick={() => submit(true)} disabled={!props.canLaunch || submitting !== null || !stepValid.every(Boolean)}>
                  {!props.canLaunch && <Lock className="size-4" aria-hidden />}
                  {submitting === "launch" ? "Launching…" : needsApproval ? "Send for approval" : f.startImmediately ? "Launch campaign" : "Schedule campaign"}
                </Button>
                <Button type="button" variant="secondary" onClick={() => submit(false)} disabled={!props.canCreate || submitting !== null || !stepValid[0]}>
                  {submitting === "draft" ? "Saving…" : "Save as draft"}
                </Button>
              </div>
              <p className="text-xs text-slate-500">Launching is logged in the audit trail. You can pause instantly at any time; only a stop is permanent.</p>
            </CardBody>
          </Card>
        )}

        <div className="flex justify-between">
          <Button type="button" variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
            Back
          </Button>
          {step < STEPS.length - 1 && (
            <Button type="button" onClick={() => setStep((s) => s + 1)} disabled={!stepValid[step]}>
              Continue
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex flex-col border-b border-slate-100 pb-2">
      <dt className="text-xs text-slate-500">{k}</dt>
      <dd className="font-medium text-slate-800">{v}</dd>
    </div>
  );
}

function Check2({ ok, warn, text }: { ok?: boolean; warn?: boolean; text: string }) {
  const Icon = warn ? AlertTriangle : ok ? CheckCircle2 : XCircle;
  const color = warn ? "text-amber-600" : ok ? "text-emerald-600" : "text-red-600";
  return (
    <li className="flex items-start gap-2">
      <Icon className={`mt-0.5 size-4 shrink-0 ${color}`} aria-hidden />
      <span>{text}</span>
    </li>
  );
}

function PolicyBox({ policy }: { policy: ReturnType<typeof checkCreative> }) {
  if (policy.ok && policy.warnings.length === 0)
    return (
      <div className="flex items-center gap-2 text-sm text-emerald-700">
        <CheckCircle2 className="size-4" aria-hidden /> Passes automated policy checks
      </div>
    );
  return (
    <div className="space-y-2">
      {policy.errors.length > 0 && (
        <Callout tone="red" title="Must fix before launch">
          <ul className="list-disc pl-5">
            {policy.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </Callout>
      )}
      {policy.warnings.length > 0 && (
        <Callout tone="amber" title="Heads-up">
          <ul className="list-disc pl-5">
            {policy.warnings.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </Callout>
      )}
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Pencil } from "lucide-react";
import { AdPreview, StatusBadge } from "@/components/campaign-bits";
import { AbTestCard } from "@/components/campaign/ab-test-card";
import { CampaignActions } from "@/components/campaign/actions";
import { BudgetEditor } from "@/components/campaign/budget-editor";
import { LiveMonitor } from "@/components/campaign/live-monitor";
import { Callout, Card, CardBody, CardHeader } from "@/components/ui";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { getMonitor } from "@/lib/monitor";
import { definitionOf } from "@/lib/audience-service";
import { getPersona } from "@/lib/personas";
import { describeDefinition } from "@/lib/segment-defs";
import { can } from "@/lib/rbac";
import { getSession } from "@/lib/session";
import { getTemplate } from "@/lib/templates";

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  const c = await db.campaign.findFirst({ where: { id, workspaceId: session.workspace.id }, include: { customPersona: true } });
  if (!c) notFound();
  const [monitor, logs, creator] = await Promise.all([
    getMonitor(session, id),
    db.auditLog.findMany({ where: { entityId: id }, orderBy: { createdAt: "desc" }, take: 25 }),
    db.user.findUnique({ where: { id: c.createdById } }),
  ]);
  const smart = getPersona(c.personaKey);
  const persona = c.customPersona
    ? { name: c.customPersona.name, definition: describeDefinition(definitionOf(c.customPersona)).join(". ") + "." }
    : { name: smart.name, definition: smart.definition };
  const template = getTemplate(c.templateKey);
  const editable = !["completed", "stopped"].includes(c.status);

  return (
    <>
      <Link href="/campaigns" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
        <ArrowLeft className="size-4" aria-hidden /> Campaigns
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{c.name}</h1>
            <StatusBadge status={c.status} />
          </div>
          <p className="mt-1 text-sm text-slate-600">
            {c.code} · {persona.name} · Media.net · {formatDateTime(c.startAt)} → {formatDateTime(c.endAt)}
            {creator ? ` · created by ${creator.name}` : ""}
          </p>
          {c.statusReason && <p className="mt-1 text-sm text-slate-500">{c.statusReason}</p>}
        </div>
        <CampaignActions
          id={c.id}
          status={c.status}
          learning={monitor.learning}
          perms={{
            canPause: can(session.role, "campaign:pause"),
            canLaunch: can(session.role, "campaign:launch"),
            canCreate: can(session.role, "campaign:create"),
            canApprove: can(session.role, "campaign:approve"),
          }}
        />
      </div>

      {c.status === "draft" && (
        <Callout tone="blue" className="mb-4" title="This is a draft">
          Nothing is running yet.{" "}
          <Link href={`/campaigns/new?draft=${c.id}`} className="inline-flex items-center gap-1 font-medium underline">
            <Pencil className="size-3.5" aria-hidden /> Edit in the wizard
          </Link>{" "}
          or launch it as is.
        </Callout>
      )}
      {c.status === "pending_approval" && (
        <Callout tone="amber" className="mb-4" title="Waiting for approval">
          {c.statusReason}. {can(session.role, "campaign:approve") ? "You can approve it above." : "An Owner or Admin needs to approve it."}
        </Callout>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_340px]">
        <div className="min-w-0">
          {["draft", "pending_approval"].includes(c.status) ? (
            <div className="space-y-4">
              <Card>
                <CardBody className="text-sm text-slate-600">The Live Monitor starts once the campaign launches.</CardBody>
              </Card>
              {monitor.abTest && <AbTestCard test={monitor.abTest} campaignId={c.id} campaignStatus={c.status} canAct={false} />}
            </div>
          ) : (
            <LiveMonitor initial={monitor} canAct={session.role !== "viewer"} />
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Budget" />
            <CardBody>
              {editable ? (
                <BudgetEditor
                  id={c.id}
                  dailyPaise={c.dailyBudgetPaise}
                  lifetimePaise={c.lifetimeBudgetPaise}
                  spentPaise={c.totalSpendPaise}
                  canEdit={can(session.role, "campaign:edit_daily_budget")}
                  canRaiseCap={can(session.role, "campaign:raise_lifetime_cap")}
                />
              ) : (
                <p className="text-sm text-slate-500">This campaign has ended. Clone it to run again.</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Audience & delivery" />
            <CardBody className="space-y-2 text-sm">
              <p className="text-slate-700">
                {c.customPersona ? (
                  <Link href={`/audiences/${c.customPersona.id}`} className="font-medium hover:underline">
                    {persona.name}
                  </Link>
                ) : (
                  <span className="font-medium">{persona.name}</span>
                )}
                : {persona.definition}
              </p>
              <p className="text-slate-500">
                Frequency cap {c.freqCapDay}/day · {c.freqCapWeek}/week{c.offerCode ? ` · offer ${c.offerCode}` : ""}
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Creative" description={template.name} />
            <CardBody>
              <AdPreview templateKey={c.templateKey} headline={c.headline} body={c.body} cta={c.cta} offerCode={c.offerCode} productIndex={1} />
              <p className="mt-2 break-all text-xs text-slate-500">{c.landingUrl}</p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Activity" description="Every launch, pause, budget change and AI decision" />
            <ul className="divide-y divide-slate-100 text-sm">
              {logs.map((l) => (
                <li key={l.id} className="px-5 py-2.5">
                  <div className="text-slate-800">{l.summary}</div>
                  <div className="text-xs text-slate-500">
                    {l.actorName} · {formatDateTime(l.createdAt)}
                  </div>
                </li>
              ))}
              {logs.length === 0 && <li className="px-5 py-3 text-slate-500">No activity yet.</li>}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}

import { CampaignWizard, type WizardInitial } from "@/components/wizard/campaign-wizard";
import { PageHeader } from "@/components/ui";
import { db } from "@/lib/db";
import { PERSONA_KEYS, type Objective, type PersonaKey } from "@/lib/domain";
import { allAudienceStats, getPersona } from "@/lib/personas";
import { getPlaybook } from "@/lib/playbooks";
import { can, needsApproval } from "@/lib/rbac";
import { getSession } from "@/lib/session";
import { getTemplate, TEMPLATES } from "@/lib/templates";
import { DAY, HOUR } from "@/lib/time";
import { walletSummary } from "@/lib/wallet";

export default async function NewCampaignPage({ searchParams }: { searchParams: Promise<{ playbook?: string; persona?: string; template?: string; draft?: string }> }) {
  const sp = await searchParams;
  const session = await getSession();
  const [stats, wallet, draft] = await Promise.all([
    allAudienceStats(db, session.workspace, session.simNow),
    walletSummary(db, session.workspace.id),
    sp.draft ? db.campaign.findFirst({ where: { id: sp.draft, workspaceId: session.workspace.id, status: "draft" } }) : null,
  ]);

  const pb = getPlaybook(sp.playbook);
  const spPersona = PERSONA_KEYS.includes(sp.persona as PersonaKey) ? (sp.persona as PersonaKey) : undefined;
  const personaKey = (draft?.personaKey ?? pb?.personaKey ?? spPersona ?? "cart_abandoners") as PersonaKey;
  const persona = getPersona(personaKey);
  const templateKey = draft?.templateKey ?? pb?.templateKey ?? (sp.template && TEMPLATES.some((t) => t.key === sp.template) ? sp.template : TEMPLATES.find((t) => t.recommendedFor.includes(personaKey))!.key);
  const t = getTemplate(templateKey);
  const start = new Date(Math.ceil(session.simNow.getTime() / HOUR) * HOUR);
  const durationDays = pb?.durationDays ?? 14;

  const initial: WizardInitial = draft
    ? {
        draftId: draft.id,
        name: draft.name,
        description: draft.description,
        objective: draft.objective as Objective,
        personaKey,
        templateKey,
        headline: draft.headline,
        body: draft.body,
        cta: draft.cta,
        landingUrl: draft.landingUrl,
        offerCode: draft.offerCode ?? "",
        dailyBudgetRupees: draft.dailyBudgetPaise / 100,
        startImmediately: false,
        startAt: draft.startAt.toISOString(),
        durationDays: Math.max(1, Math.round((draft.endAt.getTime() - draft.startAt.getTime()) / DAY)),
        freqCapDay: draft.freqCapDay,
        freqCapWeek: draft.freqCapWeek,
      }
    : {
        name: pb ? pb.name : "",
        description: pb?.summary ?? "",
        objective: persona.objective,
        personaKey,
        templateKey,
        headline: t.headline,
        body: t.body,
        cta: t.cta,
        landingUrl: "https://kaapi.example/collections/all",
        offerCode: pb?.offerCode ?? "",
        dailyBudgetRupees: 1000,
        startImmediately: true,
        startAt: start.toISOString(),
        durationDays,
        freqCapDay: pb?.freqCapDay ?? 3,
        freqCapWeek: pb?.freqCapWeek ?? 10,
      };

  return (
    <>
      <PageHeader
        title={draft ? `Edit draft ${draft.code}` : pb ? `New campaign: ${pb.name}` : "New campaign"}
        description="Five short steps. Typical setup takes under 10 minutes. Nothing is spent until you launch, and you can pause at any time."
      />
      <CampaignWizard
        initial={initial}
        audience={stats}
        walletAvailablePaise={wallet.availablePaise}
        simNow={session.simNow.toISOString()}
        canCreate={can(session.role, "campaign:create")}
        canLaunch={can(session.role, "campaign:launch")}
        approvalRole={needsApproval(session.role, Number.MAX_SAFE_INTEGER)}
      />
    </>
  );
}

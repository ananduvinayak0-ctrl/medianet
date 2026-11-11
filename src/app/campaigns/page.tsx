import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";
import { StatusBadge } from "@/components/campaign-bits";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { db } from "@/lib/db";
import { formatDate, formatINR } from "@/lib/format";
import { getPersona } from "@/lib/personas";
import { PLAYBOOKS } from "@/lib/playbooks";
import { getSession } from "@/lib/session";

export default async function CampaignsPage() {
  const session = await getSession();
  const campaigns = await db.campaign.findMany({ where: { workspaceId: session.workspace.id }, orderBy: [{ updatedAt: "desc" }] });
  const groups = [
    { title: "Needs action", items: campaigns.filter((c) => ["pending_approval", "paused", "draft"].includes(c.status)) },
    { title: "Live & scheduled", items: campaigns.filter((c) => ["live", "scheduled"].includes(c.status)) },
    { title: "Finished", items: campaigns.filter((c) => ["completed", "stopped"].includes(c.status)) },
  ];

  return (
    <>
      <PageHeader
        title="Campaigns"
        description="Start from a Retention Playbook (persona, template, frequency cap and duration pre-set) or build your own. You can change everything before launch."
        action={
          <Link href="/campaigns/new" className="inline-flex h-10 items-center gap-1.5 rounded-md bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700">
            <Plus className="size-4" aria-hidden /> New campaign
          </Link>
        }
      />

      <section className="mb-8" aria-labelledby="playbooks">
        <h2 id="playbooks" className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Retention playbooks
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {PLAYBOOKS.map((p) => (
            <Link key={p.key} href={`/campaigns/new?playbook=${p.key}`} className="group rounded-lg border border-slate-200 bg-white p-4 shadow-sm hover:border-brand-200 hover:shadow">
              <div className="font-medium text-slate-900">{p.name}</div>
              <p className="mt-1 text-sm text-slate-600">{p.summary}</p>
              <div className="mt-3 flex items-center gap-1 text-sm font-medium text-brand-600">
                Use playbook <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </div>
            </Link>
          ))}
        </div>
      </section>

      <div className="space-y-6">
        {groups.map((g) => (
          <Card key={g.title}>
            <CardHeader title={g.title} description={`${g.items.length} campaign${g.items.length === 1 ? "" : "s"}`} />
            {g.items.length === 0 ? (
              <p className="px-5 py-4 text-sm text-slate-500">Nothing here.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {g.items.map((c) => (
                  <li key={c.id}>
                    <Link href={`/campaigns/${c.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 hover:bg-slate-50">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-slate-900">{c.name}</div>
                        <div className="text-xs text-slate-500">
                          {c.code} · {getPersona(c.personaKey).name} · {formatDate(c.startAt)} – {formatDate(c.endAt)}
                          {c.statusReason ? ` · ${c.statusReason}` : ""}
                        </div>
                      </div>
                      <div className="tabular text-sm text-slate-600">
                        {formatINR(c.totalSpendPaise)} of {formatINR(c.lifetimeBudgetPaise)}
                      </div>
                      <StatusBadge status={c.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))}
      </div>
    </>
  );
}

import Link from "next/link";
import { Bot, Cog, User } from "lucide-react";
import { Callout, Card, PageHeader, Select } from "@/components/ui";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { can } from "@/lib/rbac";
import { getSession } from "@/lib/session";

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ actor?: string }> }) {
  const sp = await searchParams;
  const session = await getSession();
  if (!can(session.role, "audit:view")) {
    return (
      <>
        <PageHeader title="Audit log" />
        <Callout tone="amber">Only Owners and Admins can view the full audit log.</Callout>
      </>
    );
  }
  const actor = ["user", "system", "ai"].includes(sp.actor ?? "") ? sp.actor : undefined;
  const logs = await db.auditLog.findMany({ where: { workspaceId: session.workspace.id, ...(actor ? { actorType: actor } : {}) }, orderBy: { createdAt: "desc" }, take: 200 });
  const campaignIds = new Set((await db.campaign.findMany({ where: { workspaceId: session.workspace.id }, select: { id: true } })).map((c) => c.id));

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Append-only record of every launch, pause, budget change, approval, wallet top-up and AI suggestion (shown, accepted, edited or rejected). Kept for 2 years."
        action={
          <form action="/audit" className="flex gap-2">
            <Select name="actor" defaultValue={actor ?? ""} className="h-9 w-44" aria-label="Filter by actor">
              <option value="">All actors</option>
              <option value="user">People</option>
              <option value="system">System (safety rules)</option>
              <option value="ai">AI</option>
            </Select>
            <button className="h-9 rounded-md border border-slate-300 px-3 text-sm hover:bg-slate-50">Filter</button>
          </form>
        }
      />
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-2 font-medium">When (demo clock)</th>
                <th className="px-3 py-2 font-medium">Who</th>
                <th className="px-3 py-2 font-medium">Action</th>
                <th className="px-5 py-2 font-medium">What happened</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {logs.map((l) => {
                const Icon = l.actorType === "ai" ? Bot : l.actorType === "system" ? Cog : User;
                return (
                  <tr key={l.id} className="align-top">
                    <td className="whitespace-nowrap px-5 py-2 text-slate-600">{formatDateTime(l.createdAt)}</td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <span className="inline-flex items-center gap-1.5">
                        <Icon className="size-4 text-slate-500" aria-hidden />
                        {l.actorName}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-600">{l.action}</td>
                    <td className="px-5 py-2 text-slate-800">
                      {l.entityType === "campaign" && campaignIds.has(l.entityId) ? (
                        <Link href={`/campaigns/${l.entityId}`} className="hover:text-brand-700 hover:underline">
                          {l.summary}
                        </Link>
                      ) : (
                        l.summary
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

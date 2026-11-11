import Link from "next/link";
import { Clock, Wallet } from "lucide-react";
import { RoleSwitcher } from "@/components/role-switcher";
import { Sidebar } from "@/components/sidebar";
import { UserMenu } from "@/components/user-menu";
import { db } from "@/lib/db";
import { formatDateTime, formatINR } from "@/lib/format";
import { getSession } from "@/lib/session";
import { walletSummary } from "@/lib/wallet";

export const dynamic = "force-dynamic";

/** Shell for every signed-in page. getSession() sends signed-out visitors to /login. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const [wallet, openAlerts] = await Promise.all([
    walletSummary(db, session.workspace.id),
    db.alert.count({ where: { workspaceId: session.workspace.id, status: "open", severity: { in: ["warning", "critical"] } } }),
  ]);
  const speed = Number(process.env.SIM_SPEED ?? 120);

  return (
    <div className="flex min-h-screen">
      <Sidebar openAlerts={openAlerts} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white/90 px-4 py-2.5 backdrop-blur sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="truncate font-semibold text-slate-900">{session.workspace.name}</span>
            <span className="hidden rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 sm:inline">D2C · INR · IST</span>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="inline-flex items-center gap-1.5 text-slate-600" title={`The mock ad channel runs on a demo clock at ${speed}× real time. It pauses when nobody is using the app.`}>
              <Clock className="size-4" aria-hidden />
              <span className="tabular">{formatDateTime(session.simNow)}</span>
              <span className="rounded bg-amber-50 px-1.5 text-xs font-medium text-amber-800">demo {speed}×</span>
            </span>
            <Link href="/wallet" className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2 py-1 text-slate-700 hover:bg-slate-50">
              <Wallet className="size-4" aria-hidden />
              <span className="tabular font-medium">{formatINR(Math.max(0, wallet.availablePaise))}</span>
            </Link>
            <RoleSwitcher role={session.role} userName={session.user.name} />
            <UserMenu name={session.user.name} email={session.user.email} image={session.image} />
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">{children}</main>
      </div>
    </div>
  );
}

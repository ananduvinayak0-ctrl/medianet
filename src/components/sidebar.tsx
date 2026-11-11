"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, FlaskConical, Gauge, LayoutTemplate, Megaphone, Plus, Radio, ScrollText, Sparkles, Users, Wallet } from "lucide-react";
import { cn } from "./ui";

const NAV = [
  { href: "/dashboard", label: "Overview", icon: BarChart3 },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/ab-tests", label: "A/B tests", icon: FlaskConical },
  { href: "/audiences", label: "Audiences", icon: Users },
  { href: "/templates", label: "Template Hub", icon: LayoutTemplate },
  { href: "/pixel", label: "Pixel health", icon: Radio },
  { href: "/wallet", label: "Wallet & billing", icon: Wallet },
  { href: "/audit", label: "Audit log", icon: ScrollText },
];

const LATER = [
  { href: "/coming-soon/ad-studio", label: "Ad Studio (AI)", icon: Sparkles, when: "Q4" },
];

export function Sidebar({ openAlerts }: { openAlerts: number }) {
  const path = usePathname();
  const active = (href: string) => path === href || path.startsWith(`${href}/`);
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
      <div className="flex items-center gap-2 px-5 py-4">
        <Gauge className="size-6 text-brand-600" aria-hidden />
        <div className="leading-tight">
          <div className="text-sm font-semibold text-slate-900">Adbiz</div>
          <div className="text-xs text-slate-500">Self-serve retention ads</div>
        </div>
      </div>
      <div className="px-3">
        <Link href="/campaigns/new" className="mb-3 flex h-9 items-center justify-center gap-1.5 rounded-md bg-brand-600 text-sm font-medium text-white hover:bg-brand-700">
          <Plus className="size-4" aria-hidden /> New campaign
        </Link>
      </div>
      <nav className="flex-1 space-y-0.5 px-3" aria-label="Main">
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className={cn("flex items-center gap-2.5 rounded-md px-3 py-2 text-sm", active(n.href) ? "bg-brand-50 font-medium text-brand-700" : "text-slate-700 hover:bg-slate-50")}
            aria-current={active(n.href) ? "page" : undefined}
          >
            <n.icon className="size-4" aria-hidden />
            <span className="flex-1">{n.label}</span>
            {n.href === "/dashboard" && openAlerts > 0 && (
              <span className="rounded-full bg-amber-100 px-1.5 text-xs font-medium text-amber-800" aria-label={`${openAlerts} open alerts`}>
                {openAlerts}
              </span>
            )}
          </Link>
        ))}
        <div className="px-3 pb-1 pt-5 text-xs font-medium uppercase tracking-wide text-slate-400">On the roadmap</div>
        {LATER.map((n) => (
          <Link key={n.href} href={n.href} className={cn("flex items-center gap-2.5 rounded-md px-3 py-2 text-sm", active(n.href) ? "bg-slate-100 text-slate-700" : "text-slate-400 hover:bg-slate-50")}>
            <n.icon className="size-4" aria-hidden />
            <span className="flex-1">{n.label}</span>
            <span className="text-xs">{n.when}</span>
          </Link>
        ))}
      </nav>
      <div className="border-t border-slate-100 px-5 py-3 text-xs text-slate-400">MVP demo · mock Media.net adapter</div>
    </aside>
  );
}

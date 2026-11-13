import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ArrowRight, BarChart3, FlaskConical, Gauge, Users } from "lucide-react";
import { LOGIN_COOKIE } from "@/lib/session";
import { login } from "./actions";

export const metadata: Metadata = { title: "Log in · Adbiz" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const sp = await searchParams;
  if ((await cookies()).get(LOGIN_COOKIE)?.value) redirect("/dashboard");

  return (
    <div className="flex min-h-screen flex-col bg-white lg:flex-row">
      <section className="flex flex-1 flex-col justify-between bg-brand-600 px-6 py-8 text-white sm:px-10 lg:max-w-xl lg:py-12">
        <div className="flex items-center gap-2">
          <Gauge className="size-7" aria-hidden />
          <div className="leading-tight">
            <div className="text-lg font-semibold">Adbiz</div>
            <div className="text-sm text-white/80">Self-serve campaign tool</div>
          </div>
        </div>
        <div className="my-10 space-y-6">
          <h1 className="text-3xl font-semibold leading-tight sm:text-4xl">Launch in minutes.<br />Prove every rupee.</h1>
          <ul className="space-y-3 text-white/90">
            <li className="flex gap-3">
              <Users className="mt-0.5 size-5 shrink-0" aria-hidden /> Build audiences from your customers&apos; lifecycle, value and behaviour.
            </li>
            <li className="flex gap-3">
              <BarChart3 className="mt-0.5 size-5 shrink-0" aria-hidden /> Every campaign measured against a fair control group.
            </li>
            <li className="flex gap-3">
              <FlaskConical className="mt-0.5 size-5 shrink-0" aria-hidden /> A/B test creatives with an honest answer.
            </li>
          </ul>
        </div>
        <p className="text-xs text-white/70">Demo workspace with synthetic data. No real ads are bought.</p>
      </section>

      <section className="flex flex-1 items-center justify-center px-4 py-12 sm:px-10">
        <form action={login} className="w-full max-w-sm space-y-6">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Welcome to Adbiz</h2>
            <p className="mt-1 text-sm text-slate-600">No account needed. Log in to explore the demo brand &ldquo;Kaapi &amp; Co.&rdquo; You can switch roles from the top bar once you&apos;re in.</p>
          </div>
          <input type="hidden" name="next" value={sp.next ?? ""} />
          <button
            type="submit"
            className="flex h-11 w-full items-center justify-center gap-2 rounded-md bg-brand-600 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
          >
            Log in <ArrowRight className="size-4" aria-hidden />
          </button>
        </form>
      </section>
    </div>
  );
}

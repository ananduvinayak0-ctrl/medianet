import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { BarChart3, FlaskConical, Gauge, ShieldCheck, Users } from "lucide-react";
import { authConfigured, authOptions } from "@/lib/auth";
import { GoogleButton } from "./google-button";

export const metadata: Metadata = { title: "Sign in · Media.net Campaigns" };
export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  AccessDenied: "That Google account couldn't be used. Make sure its email address is verified, then try again.",
  OAuthSignin: "We couldn't start Google sign-in. Please try again.",
  OAuthCallback: "Google sign-in didn't complete. Please try again.",
  OAuthAccountNotLinked: "That email is already linked to a different sign-in method.",
  Callback: "Google sign-in didn't complete. Please try again.",
  Configuration: "Google sign-in isn't configured correctly on the server.",
  SessionRequired: "Please sign in to continue.",
};

/** Only same-site paths, so the login page can't be used to bounce people to another site. */
function safeCallback(raw: string | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\") || raw.startsWith("/login")) return "/dashboard";
  return raw;
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string; error?: string }> }) {
  const sp = await searchParams;
  const callbackUrl = safeCallback(sp.callbackUrl);
  if ((await getServerSession(authOptions))?.user?.email) redirect(callbackUrl);
  const error = sp.error ? (ERRORS[sp.error] ?? "Sign-in failed. Please try again.") : null;

  return (
    <div className="flex min-h-screen flex-col bg-white lg:flex-row">
      <section className="flex flex-1 flex-col justify-between bg-brand-600 px-6 py-8 text-white sm:px-10 lg:max-w-xl lg:py-12">
        <div className="flex items-center gap-2">
          <Gauge className="size-7" aria-hidden />
          <div className="leading-tight">
            <div className="font-semibold">Media.net</div>
            <div className="text-sm text-white/80">Self-serve campaigns</div>
          </div>
        </div>
        <div className="my-10 space-y-6">
          <h1 className="text-3xl font-semibold leading-tight sm:text-4xl">Retention ads that prove they work.</h1>
          <ul className="space-y-3 text-white/90">
            <li className="flex gap-3">
              <Users className="mt-0.5 size-5 shrink-0" aria-hidden /> Build audiences from your customers' lifecycle, value and behaviour.
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
        <div className="w-full max-w-sm space-y-6">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Sign in</h2>
            <p className="mt-1 text-sm text-slate-600">Use any Google account (Gmail or Google Workspace). First time here? Signing in creates your access automatically.</p>
          </div>

          {error && (
            <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {error}
            </div>
          )}
          {!authConfigured && (
            <div role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Google sign-in isn&apos;t set up on this server yet. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and NEXTAUTH_SECRET to the environment.
            </div>
          )}

          <GoogleButton callbackUrl={callbackUrl} disabled={!authConfigured} />

          <p className="flex items-start gap-2 text-xs text-slate-500">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
            We only receive your name, email address and profile photo from Google. We never see your password.
          </p>
        </div>
      </section>
    </div>
  );
}

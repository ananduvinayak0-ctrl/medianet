"use client";

import { signOut } from "next-auth/react";
import { useState } from "react";
import { LogOut } from "lucide-react";

export function UserMenu({ name, email, image }: { name: string; email: string; image: string | null }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="inline-flex items-center gap-2">
      {image ? (
        // Google profile photo; plain <img> avoids configuring remote image domains.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" className="size-7 rounded-full" referrerPolicy="no-referrer" />
      ) : (
        <span className="flex size-7 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white" aria-hidden>
          {name.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="hidden max-w-40 truncate text-slate-600 xl:inline" title={email}>
        {email}
      </span>
      <button
        type="button"
        onClick={() => {
          setBusy(true);
          signOut({ callbackUrl: "/login" });
        }}
        disabled={busy}
        className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
        title="Sign out"
      >
        <LogOut className="size-4" aria-hidden />
        <span className="hidden sm:inline">Sign out</span>
      </button>
    </div>
  );
}

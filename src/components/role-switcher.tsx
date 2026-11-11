"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { ROLES, type Role } from "@/lib/domain";
import { ROLE_LABEL } from "@/lib/rbac";
import { api } from "@/lib/client";

export function RoleSwitcher({ role, userName }: { role: Role; userName: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <label className="inline-flex items-center gap-2 text-slate-600">
      <span className="hidden lg:inline">{userName} ·</span>
      <span className="sr-only">Demo role</span>
      <select
        className="h-8 rounded-md border border-slate-300 bg-white px-2 text-sm"
        value={role}
        disabled={pending}
        onChange={(e) =>
          start(async () => {
            await api("/api/session/role", { body: { role: e.target.value } });
            router.refresh();
          })
        }
        title="Switch demo role to see permissions change"
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABEL[r]}
          </option>
        ))}
      </select>
    </label>
  );
}

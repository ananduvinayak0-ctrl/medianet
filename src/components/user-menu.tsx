import { LogOut } from "lucide-react";
import { logout } from "@/app/login/actions";

export function UserMenu() {
  return (
    <form action={logout}>
      <button type="submit" className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900" title="Log out">
        <LogOut className="size-4" aria-hidden />
        <span className="hidden sm:inline">Log out</span>
      </button>
    </form>
  );
}

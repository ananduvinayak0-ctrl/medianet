"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { LOGIN_COOKIE, ROLE_COOKIE } from "@/lib/session";

/** Same-site paths only, so the login page can't bounce people to another site. */
function safePath(raw: FormDataEntryValue | null): string {
  const s = typeof raw === "string" ? raw : "";
  if (!s.startsWith("/") || s.startsWith("//") || s.startsWith("/\\") || s.startsWith("/login")) return "/dashboard";
  return s;
}

/** Open access: anyone can log in, no username or password. */
export async function login(formData: FormData) {
  const jar = await cookies();
  jar.set(LOGIN_COOKIE, crypto.randomUUID(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 7 * 24 * 60 * 60,
  });
  redirect(safePath(formData.get("next")));
}

export async function logout() {
  const jar = await cookies();
  jar.delete(LOGIN_COOKIE);
  jar.delete(ROLE_COOKIE);
  redirect("/login");
}

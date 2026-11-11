import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

// Sign in with Google. Anyone with a Google account (Gmail or Google Workspace) whose email is
// verified can sign in; on first sign-in they're added to the demo workspace (see session.ts).
// Sessions are signed JWT cookies, so the middleware can check them without a database call.

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      authorization: { params: { prompt: "select_account" } },
    }),
  ],
  session: { strategy: "jwt", maxAge: 7 * 24 * 60 * 60 },
  pages: { signIn: "/login", error: "/login" },
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider !== "google") return false;
      const p = profile as { email?: string; email_verified?: boolean } | undefined;
      return Boolean(p?.email && p.email_verified);
    },
  },
};

export const authConfigured = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.NEXTAUTH_SECRET);

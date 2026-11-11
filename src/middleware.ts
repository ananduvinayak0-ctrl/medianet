import { getToken } from "next-auth/jwt";
import { NextResponse, type NextRequest } from "next/server";

// Every page and API route needs a signed-in Google user, except the login page and the
// sign-in endpoints themselves. Pages redirect to /login; API calls get a 401.

export async function middleware(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (token?.email) return NextResponse.next();
  if (req.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({ error: "Please sign in" }, { status: 401 });
  const url = new URL("/login", req.url);
  const back = req.nextUrl.pathname + req.nextUrl.search;
  if (back !== "/") url.searchParams.set("callbackUrl", back);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!login|api/auth|_next/static|_next/image|favicon.ico|icon.svg).*)"],
};

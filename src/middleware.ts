import { NextResponse, type NextRequest } from "next/server";

// Every page and API route needs a logged-in visitor, except the login page itself.
// Login is open to anyone (no username or password); it just sets this cookie.
// Pages redirect to /login; API calls get a 401.

const LOGIN_COOKIE = "adbiz_session";

export function middleware(req: NextRequest) {
  if (req.cookies.get(LOGIN_COOKIE)?.value) return NextResponse.next();
  if (req.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({ error: "Please log in" }, { status: 401 });
  const url = new URL("/login", req.url);
  const back = req.nextUrl.pathname + req.nextUrl.search;
  if (back !== "/") url.searchParams.set("next", back);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico|icon.svg).*)"],
};

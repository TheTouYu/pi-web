import { NextResponse, type NextRequest } from "next/server";
import { isApiRequestAllowed } from "@/lib/request-security";
import { authenticationEnabled, isAuthenticatedCookie } from "@/lib/auth";

const PUBLIC_EXACT = new Set(["/login", "/api/web-auth/login", "/api/health"]);
function publicPath(pathname: string): boolean {
  return PUBLIC_EXACT.has(pathname) || pathname.startsWith("/_next/static/") || pathname.startsWith("/_next/image/") || pathname === "/favicon.ico";
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (pathname.startsWith("/api/") && !isApiRequestAllowed(request)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!authenticationEnabled() || publicPath(pathname)) return NextResponse.next();
  if (isAuthenticatedCookie(request.headers.get("cookie"))) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const login = new URL("/login", request.url);
  const returnTo = `${pathname}${search}`;
  if (returnTo.startsWith("/") && !returnTo.startsWith("//")) login.searchParams.set("returnTo", returnTo);
  return NextResponse.redirect(login);
}

export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };

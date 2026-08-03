import { NextResponse, type NextRequest } from "next/server";
import { isApiRequestAllowed } from "@/lib/request-security";
import { authenticationEnabled, cookieRole } from "@/lib/auth";

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
  const role = cookieRole(request.headers.get("cookie"));
  if (role === null) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const login = new URL("/login", request.url);
    const returnTo = `${pathname}${search}`;
    if (returnTo.startsWith("/") && !returnTo.startsWith("//")) login.searchParams.set("returnTo", returnTo);
    return NextResponse.redirect(login);
  }
  // 只读账号只能查看：拦截一切非 GET/HEAD 的 API 请求（登出除外）。
  if (role === "readonly" && pathname.startsWith("/api/") && request.method !== "GET" && request.method !== "HEAD" && pathname !== "/api/web-auth/logout") {
    return NextResponse.json({ error: "Read-only account cannot modify data" }, { status: 403 });
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };

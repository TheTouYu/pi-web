import { NextResponse } from "next/server";
import { cookieRole, hasConfiguredReadonlyPassword } from "@/lib/auth";

// GET /api/web-auth/me - 当前登录角色
export async function GET(req: Request) {
  const role = cookieRole(req.headers.get("cookie"));
  if (!role) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  return NextResponse.json({ role, readonlyConfigured: hasConfiguredReadonlyPassword() });
}

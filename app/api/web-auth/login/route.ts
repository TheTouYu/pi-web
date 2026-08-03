import { NextResponse } from "next/server";
import { createLoginCookie, verifyAdministratorPassword, verifyReadonlyPassword, type AuthRole } from "@/lib/auth";

export async function POST(req: Request) {
  const { password, mode } = await req.json().catch(() => ({})) as { password?: unknown; mode?: unknown };
  if (typeof password !== "string") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const role: AuthRole = mode === "readonly" ? "readonly" : "admin";
  const verified = role === "readonly"
    ? verifyReadonlyPassword(password)
    : verifyAdministratorPassword(password);
  if (!verified) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }
  const response = NextResponse.json({ ok: true, role });
  response.headers.set("Set-Cookie", createLoginCookie(new URL(req.url).protocol === "https:", role));
  return response;
}

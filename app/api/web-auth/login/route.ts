import { NextResponse } from "next/server";
import { createLoginCookie, verifyAdministratorPassword } from "@/lib/auth";

export async function POST(req: Request) {
  const { password } = await req.json().catch(() => ({})) as { password?: unknown };
  if (typeof password !== "string" || !verifyAdministratorPassword(password)) {
    return NextResponse.json({ error: "Invalid administrator password" }, { status: 401 });
  }
  const response = NextResponse.json({ ok: true });
  response.headers.set("Set-Cookie", createLoginCookie(new URL(req.url).protocol === "https:"));
  return response;
}

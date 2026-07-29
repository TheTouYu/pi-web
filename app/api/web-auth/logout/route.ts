import { NextResponse } from "next/server";
import { clearLoginCookie } from "@/lib/auth";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.headers.set("Set-Cookie", clearLoginCookie());
  return response;
}

"use client";

import { useState } from "react";

export default function LoginPage() {
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    const password = String(new FormData(event.currentTarget).get("password") || "");
    const response = await fetch("/api/web-auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
    if (!response.ok) { setError("密码错误"); return; }
    const returnTo = new URLSearchParams(location.search).get("returnTo");
    location.href = returnTo?.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/";
  }
  return <main className="min-h-screen flex items-center justify-center bg-[var(--bg)] text-[var(--text)]">
    <form onSubmit={submit} className="w-full max-w-sm rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] p-6 space-y-4">
      <h1 className="text-xl font-semibold">Pi Web 管理员登录</h1>
      <input name="password" type="password" autoFocus autoComplete="current-password" required className="w-full rounded border border-[var(--border)] bg-[var(--bg)] px-3 py-2" placeholder="管理员密码" />
      {error && <p className="text-red-500 text-sm">{error}</p>}
      <button className="w-full rounded bg-[var(--accent)] px-3 py-2 text-white" type="submit">登录</button>
    </form>
  </main>;
}

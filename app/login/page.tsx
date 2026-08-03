"use client";

import { useState } from "react";

type LoginMode = "admin" | "readonly";

export default function LoginPage() {
  const [mode, setMode] = useState<LoginMode>("admin");
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    const password = String(new FormData(event.currentTarget).get("password") || "");
    const response = await fetch("/api/web-auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password, mode }) });
    if (!response.ok) { setError("密码错误"); return; }
    try { localStorage.setItem("pi-web-role", mode); } catch { /* ignore */ }
    const returnTo = new URLSearchParams(location.search).get("returnTo");
    location.href = returnTo?.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/";
  }
  return <main className="min-h-screen flex items-center justify-center bg-[var(--bg)] text-[var(--text)]">
    <form onSubmit={submit} className="w-full max-w-sm rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] p-6 space-y-4">
      <h1 className="text-xl font-semibold">Pi Web 登录</h1>
      <div className="flex rounded border border-[var(--border)] overflow-hidden">
        {(["admin", "readonly"] as LoginMode[]).map((m) => (
          <button key={m} type="button" onClick={() => { setMode(m); setError(""); }}
            className={`flex-1 px-3 py-2 text-sm ${mode === m ? "bg-[var(--accent)] text-white" : "bg-[var(--bg)] text-[var(--text-muted)]"}`}>
            {m === "admin" ? "管理员" : "只读"}
          </button>
        ))}
      </div>
      <input name="password" type="password" autoFocus autoComplete="current-password" required className="w-full rounded border border-[var(--border)] bg-[var(--bg)] px-3 py-2" placeholder={mode === "admin" ? "管理员密码" : "只读密码"} />
      {error && <p className="text-red-500 text-sm">{error}</p>}
      <button className="w-full rounded bg-[var(--accent)] px-3 py-2 text-white" type="submit">登录</button>
    </form>
  </main>;
}

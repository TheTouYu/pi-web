export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { configureHttpDispatcher } = await import("@/lib/http-dispatcher");
  configureHttpDispatcher();

  // Session invalidations only clear caches here. Open pages reload the
  // authoritative JSONL through their existing session/context endpoints.
  const [{ subscribeHub }, { invalidateSessionListCache, invalidateSessionPathCache }] = await Promise.all([
    import("@/lib/live/hub-client"),
    import("@/lib/session-reader"),
  ]);
  const key = Symbol.for("pi-web.live-invalidation-subscription");
  const globals = globalThis as typeof globalThis & { [key: symbol]: (() => void) | undefined };
  if (!globals[key]) globals[key] = subscribeHub((message) => {
    if (message.type !== "invalidation" || typeof message.sessionId !== "string") return;
    invalidateSessionListCache();
    if (message.scope === "all") invalidateSessionPathCache(message.sessionId);
  });
}

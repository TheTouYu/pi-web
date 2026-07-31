import { getRunningRpcSessions, subscribeRunningSessions } from "@/lib/rpc-manager";
import { getObservedPresence, getObservedSession, subscribeHub } from "@/lib/live/hub-client";

export const dynamic = "force-dynamic";

// GET /api/agent/running/events - SSE stream of the set of currently-running
// session ids, each with its cwd so the client can tell which project a
// session belongs to. Pushes an update whenever any session starts or stops
// working, so the sidebar never has to poll.
export async function GET(req: Request) {
  const stream = new ReadableStream({
    async start(controller) {
      let observedRunning = new Set((await getObservedPresence()).filter((p) => p.busy).map((p) => p.sessionId));
      let lastRunningSnapshot = "";
      // Monotonic guard: encodeRunning awaits hub snapshots, so a slow call
      // must not enqueue a stale snapshot after a newer one was already sent.
      let generation = 0;
      const encodeRunning = async () => {
        const gen = ++generation;
        const rpcSessions = getRunningRpcSessions();
        const cwdById = new Map(rpcSessions.map((s) => [s.id, s.cwd]));
        // Observed (terminal) sessions: fetch their cwd from the hub snapshot.
        const missing = [...observedRunning].filter((id) => !cwdById.has(id));
        if (missing.length > 0) {
          await Promise.all(missing.map(async (id) => {
            try {
              const observed = await getObservedSession(id);
              if (observed) cwdById.set(id, observed.snapshot.cwd);
            } catch { /* hub unavailable — send what we have */ }
          }));
        }
        if (gen !== generation) return; // superseded by a newer encode
        const running = [...new Set([...rpcSessions.map((s) => s.id), ...observedRunning])].sort().map((id) => {
          const cwd = cwdById.get(id);
          return cwd ? { id, cwd } : { id };
        });
        const snapshot = JSON.stringify(running);
        if (snapshot === lastRunningSnapshot) return;
        lastRunningSnapshot = snapshot;
        try {
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: "running", runningSessionIds: running.map((s) => s.id), running })}\n\n`));
        } catch {
          // controller already closed
        }
      };

      // Subscribe BEFORE taking the initial snapshot so no state change can slip
      // through the gap between snapshot and subscription.
      const unsubscribe = subscribeRunningSessions(() => {
        void encodeRunning().catch(() => {});
      });

      // Initial snapshot so the client renders the correct state immediately.
      void encodeRunning().catch(() => {});

      const unsubscribeHub = subscribeHub((message) => {
        if (message.type !== "presence" || !Array.isArray(message.sessions)) return;
        observedRunning = new Set((message.sessions as Array<{ sessionId: string; busy: boolean }>).filter((p) => p.busy).map((p) => p.sessionId));
        void encodeRunning().catch(() => {});
      });

      // Heartbeat to keep the connection alive through proxies/timeouts.
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(new TextEncoder().encode(":\n\n"));
        } catch {
          // controller already closed
        }
      }, 30_000);

      const cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
        unsubscribeHub();
        try { controller.close(); } catch { /* already closed */ }
      };

      req.signal?.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

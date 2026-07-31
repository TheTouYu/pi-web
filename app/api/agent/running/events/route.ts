import { getRunningRpcSessionIds, subscribeRunningSessions } from "@/lib/rpc-manager";
import { getObservedPresence, subscribeHub } from "@/lib/live/hub-client";

export const dynamic = "force-dynamic";

// GET /api/agent/running/events - SSE stream of the set of currently-running
// session ids. Pushes an update whenever any session starts or stops working,
// so the sidebar never has to poll.
export async function GET(req: Request) {
  const stream = new ReadableStream({
    async start(controller) {
      let observedRunning = new Set((await getObservedPresence()).filter((p) => p.busy).map((p) => p.sessionId));
      const combined = (rpcIds = getRunningRpcSessionIds()) => [...new Set([...rpcIds, ...observedRunning])];
      let lastRunningSnapshot = "";
      const encodeRunning = (ids: string[]) => {
        const runningSessionIds = [...new Set(ids)].sort();
        const snapshot = JSON.stringify(runningSessionIds);
        if (snapshot === lastRunningSnapshot) return;
        lastRunningSnapshot = snapshot;
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: "running", runningSessionIds })}\n\n`));
      };

      // Subscribe BEFORE taking the initial snapshot so no state change can slip
      // through the gap between snapshot and subscription.
      const unsubscribe = subscribeRunningSessions((ids) => {
        try {
          encodeRunning(combined(ids));
        } catch {
          // controller already closed
        }
      });

      // Initial snapshot so the client renders the correct state immediately.
      encodeRunning(combined());

      const unsubscribeHub = subscribeHub((message) => {
        if (message.type !== "presence" || !Array.isArray(message.sessions)) return;
        observedRunning = new Set((message.sessions as Array<{ sessionId: string; busy: boolean }>).filter((p) => p.busy).map((p) => p.sessionId));
        try { encodeRunning(combined()); } catch {}
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

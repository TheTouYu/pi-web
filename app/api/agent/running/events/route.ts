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
      const combined = () => [...new Set([...getRunningRpcSessionIds(), ...observedRunning])];
      const encode = (data: unknown) => {
        const text = `data: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(new TextEncoder().encode(text));
      };

      // Subscribe BEFORE taking the initial snapshot so no state change can slip
      // through the gap between snapshot and subscription.
      const unsubscribe = subscribeRunningSessions((ids) => {
        try {
          encode({ type: "running", runningSessionIds: [...new Set([...ids, ...observedRunning])] });
        } catch {
          // controller already closed
        }
      });

      // Initial snapshot so the client renders the correct state immediately.
      // (A duplicate frame here is harmless: the client just sets the same set.)
      encode({ type: "running", runningSessionIds: combined() });

      const unsubscribeHub = subscribeHub((message) => {
        if (message.type !== "presence" || !Array.isArray(message.sessions)) return;
        observedRunning = new Set((message.sessions as Array<{ sessionId: string; busy: boolean }>).filter((p) => p.busy).map((p) => p.sessionId));
        try { encode({ type: "running", runningSessionIds: combined() }); } catch {}
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

import { resolveSessionPath } from "@/lib/session-reader";
import { getRpcSession } from "@/lib/rpc-manager";
import { getObservedSession, subscribeHub } from "@/lib/live/hub-client";
import { guardedStartRpcSession } from "@/lib/live/runtime-router";
import { SessionManager } from "@earendil-works/pi-coding-agent";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const observed = await getObservedSession(id);
  let web = getRpcSession(id);

  // An observed claim (including its disconnect reservation) is authoritative:
  // opening/reconnecting SSE must never create a fallback Web runtime.
  if (!observed && (!web || !web.isAlive())) {
    const filePath = await resolveSessionPath(id);
    if (!filePath) return new Response("Session not found", { status: 404 });
    const cwd = SessionManager.open(filePath).getHeader()?.cwd ?? process.cwd();
    try { ({ session: web } = await guardedStartRpcSession(id, filePath, cwd)); }
    catch (error) {
      // Recheck after the atomic guard: a terminal may have attached between
      // our first probe and start attempt.
      if (!await getObservedSession(id)) return new Response(`Failed to start agent: ${error}`, { status: 500 });
    }
  }

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const encode = (data: unknown) => {
        if (closed) return;
        try { controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`)); } catch { closed = true; }
      };
      encode({ type: "connected", sessionId: id, runtime: observed ? "observed" : "web" });
      if (observed) encode({ type: "live_snapshot", sessionId: id, presence: observed.presence, snapshot: observed.snapshot });

      const unsubscribeWeb = web?.onEvent((event) => encode(event)) ?? (() => {});
      const unsubscribeHub = subscribeHub((message) => {
        if (message.sessionId !== id) return;
        if (message.type === "event") encode(message.event);
        else if (message.type === "snapshot") encode({ type: "live_snapshot", sessionId: id, snapshot: message.snapshot });
        else if (message.type === "interrupted") encode({ type: "live_interrupted", sessionId: id, snapshot: message.snapshot });
        else if (message.type === "invalidation") encode({ type: "session_invalidation", sessionId: id, scope: message.scope });
        else if (message.type === "claim_released") encode({ type: "live_claim_released", sessionId: id });
      });
      const heartbeat = setInterval(() => { if (!closed) try { controller.enqueue(new TextEncoder().encode(":\n\n")); } catch { closed = true; } }, 30_000);
      const cleanup = () => { if (closed) return; closed = true; clearInterval(heartbeat); unsubscribeWeb(); unsubscribeHub(); try { controller.close(); } catch {} };
      req.signal.addEventListener("abort", cleanup, { once: true });
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } });
}

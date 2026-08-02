import { NextResponse } from "next/server";
import { resolveSessionPath } from "@/lib/session-reader";
import { resolveRuntime, sendRuntimeCommand } from "@/lib/live/runtime-router";
import { SessionManager } from "@earendil-works/pi-coding-agent";

// POST /api/agent/[id] - Send a command to an existing session
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await req.json() as { type: string; [key: string]: unknown };
    const clientId = req.headers.get("x-pi-web-client-id") ?? "observer";

    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const cwd = SessionManager.open(filePath).getHeader()?.cwd ?? process.cwd();

    const commandId = req.headers.get("x-pi-web-command-id") ?? undefined;
    const result = await sendRuntimeCommand(id, body, async () => {
      const { guardedStartRpcSession } = await import("@/lib/live/runtime-router");
      return guardedStartRpcSession(id, filePath, cwd);
    }, { clientId, commandId });

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : undefined;
    const status = code === "unsupported" ? 409 : code === "reserved" || code === "no_claim" ? 423 : 500;
    return NextResponse.json({ error: String(error), ...(code ? { code } : {}) }, { status });
  }
}

// GET /api/agent/[id] - Get current agent state
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const runtime = await resolveRuntime(id);
    if (runtime.kind === "none") return NextResponse.json({ running: false });
    if (runtime.kind === "observed") {
      return NextResponse.json({
        running: runtime.presence.busy,
        runtime: "observed",
        presence: runtime.presence,
        state: { ...runtime.snapshot.state, isStreaming: runtime.snapshot.busy, isPromptRunning: runtime.snapshot.busy },
      });
    }
    const state = await runtime.session.send({ type: "get_state" });
    return NextResponse.json({ running: true, runtime: "web", state });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

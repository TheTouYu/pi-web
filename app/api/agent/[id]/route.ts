import { NextResponse } from "next/server";
import { resolveSessionPath } from "@/lib/session-reader";
import { resolveRuntime, sendRuntimeCommand } from "@/lib/live/runtime-router";
import { hubRequest } from "@/lib/live/hub-client";
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
    if (body.type === "acquire_control") {
      const result = await hubRequest({ type: "control_acquire", sessionId: id, clientId });
      return NextResponse.json({ success: true, data: result });
    }
    if (body.type === "release_control") {
      const result = await hubRequest({ type: "control_release", sessionId: id, clientId, token: body.controlToken });
      return NextResponse.json({ success: true, data: result });
    }

    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const cwd = SessionManager.open(filePath).getHeader()?.cwd ?? process.cwd();

    const commandId = req.headers.get("x-pi-web-command-id") ?? undefined;
    const controlToken = req.headers.get("x-pi-web-control-token") ?? undefined;
    const result = await sendRuntimeCommand(id, body, async () => {
      const { guardedStartRpcSession } = await import("@/lib/live/runtime-router");
      return guardedStartRpcSession(id, filePath, cwd);
    }, { clientId, commandId, controlToken });

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

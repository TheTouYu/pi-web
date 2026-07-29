import { NextResponse } from "next/server";
import { resolveSessionPath } from "@/lib/session-reader";
import { resolveRuntime } from "@/lib/live/runtime-router";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    if (!await resolveSessionPath(id)) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const runtime = await resolveRuntime(id);
    if (runtime.kind === "none") return NextResponse.json({ running: false });
    if (runtime.kind === "observed") return NextResponse.json({
      running: runtime.presence.busy,
      runtime: "observed",
      presence: runtime.presence,
      state: { ...runtime.snapshot.state, isStreaming: runtime.snapshot.busy, isPromptRunning: runtime.snapshot.busy },
    });
    const state = await runtime.session.send({ type: "get_state" });
    return NextResponse.json({ running: true, runtime: "web", state });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

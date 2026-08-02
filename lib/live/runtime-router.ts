import { randomUUID } from "node:crypto";
import { getRpcSession, startRpcSession, type AgentSessionWrapper } from "../rpc-manager";
import { getObservedSession, sendObservedCommand } from "./hub-client";
import type { AttachmentSnapshot, LivePresence } from "./protocol";

export type RuntimeResolution =
  | { kind: "observed"; presence: LivePresence; snapshot: AttachmentSnapshot }
  | { kind: "web"; session: AgentSessionWrapper }
  | { kind: "none" };

export async function resolveRuntime(sessionId: string): Promise<RuntimeResolution> {
  const observed = await getObservedSession(sessionId);
  if (observed) return { kind: "observed", ...observed };
  const web = getRpcSession(sessionId);
  return web?.isAlive() ? { kind: "web", session: web } : { kind: "none" };
}

export async function sendRuntimeCommand(
  sessionId: string,
  command: Record<string, unknown>,
  startWeb: () => Promise<{ session: AgentSessionWrapper }>,
  identity?: { clientId?: string; commandId?: string },
): Promise<unknown> {
  const observed = await getObservedSession(sessionId);
  if (observed) {
    return sendObservedCommand(
      sessionId,
      identity?.clientId || "observer",
      identity?.commandId || randomUUID(),
      command,
    );
  }
  const existing = getRpcSession(sessionId);
  const runtime = existing?.isAlive() ? existing : (await startWeb()).session;
  return runtime.send(command);
}

export async function guardedStartRpcSession(
  ...args: [...Parameters<typeof startRpcSession>, options?: { explicitContinuation?: boolean }]
): ReturnType<typeof startRpcSession> {
  const options = args.length > 4 ? args.pop() as { explicitContinuation?: boolean } : undefined;
  const sessionArgs = args as Parameters<typeof startRpcSession>;
  const observed = await getObservedSession(sessionArgs[0]);
  if (observed) throw new Error(observed.presence.connected
    ? "Session is claimed by an observed Pi runtime"
    : "Observed Pi runtime is reconnecting; explicit Web continuation is required");
  const ownerId = randomUUID();
  let hubClaimed = false;
  try {
    await (await import("./hub-client")).hubRequest({ type: "web_claim", sessionId: sessionArgs[0], ownerId, explicit: !!options?.explicitContinuation });
    hubClaimed = true;
  } catch (error) {
    // Live Integration absence must not break pre-existing Web-managed sessions.
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== "unavailable") throw error;
  }
  try {
    const result = await startRpcSession(...sessionArgs);
    if (hubClaimed) result.session.onDestroy(() => {
      void import("./hub-client").then(({ hubRequest }) => hubRequest({ type: "web_release", sessionId: sessionArgs[0], ownerId })).catch(() => {});
    });
    return result;
  } catch (error) {
    if (hubClaimed) await (await import("./hub-client")).hubRequest({ type: "web_release", sessionId: sessionArgs[0], ownerId }).catch(() => {});
    throw error;
  }
}

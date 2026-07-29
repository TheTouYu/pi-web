// Client-side helper for POST /api/agent/[id].
//
// Every /api/agent/[id] route returns one of:
//   { success: true, data: <result> }
//   { error: string }              (non-2xx)
//
// Call sites previously repeated the same 5-line fetch block 13× in
// hooks/useAgentSession.ts. This helper collapses that down to one line.

const controlTokens = new Map<string, string>();

function pageClientId(): string {
  const globals = globalThis as typeof globalThis & { __piWebClientId?: string };
  if (!globals.__piWebClientId) globals.__piWebClientId = crypto.randomUUID();
  return globals.__piWebClientId;
}

export async function sendAgentCommand<T = unknown>(
  sessionId: string,
  command: Record<string, unknown>,
  options: { commandId?: string } = {},
): Promise<T> {
  const commandId = options.commandId ?? crypto.randomUUID();
  const res = await fetch(`/api/agent/${encodeURIComponent(sessionId)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Pi-Web-Client-Id": pageClientId(),
      "X-Pi-Web-Command-Id": commandId,
      ...(controlTokens.has(sessionId) ? { "X-Pi-Web-Control-Token": controlTokens.get(sessionId)! } : {}),
    },
    body: JSON.stringify(command),
  });
  const body = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    data?: T;
    error?: string;
  };
  if (!res.ok || body.error) {
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return body.data as T;
}

export async function acquireSharedControl(sessionId: string): Promise<{ capabilities: string[]; instanceId: string }> {
  const result = await sendAgentCommand<{ token: string; capabilities: string[]; instanceId: string }>(sessionId, { type: "acquire_control" });
  controlTokens.set(sessionId, result.token);
  return result;
}

export async function releaseSharedControl(sessionId: string): Promise<void> {
  const token = controlTokens.get(sessionId);
  controlTokens.delete(sessionId);
  if (token) await sendAgentCommand(sessionId, { type: "release_control", controlToken: token }).catch(() => {});
}

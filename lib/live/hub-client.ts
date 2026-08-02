import net from "node:net";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { LIVE_LIMITS } from "./constants";
import type { AttachmentSnapshot, LivePresence } from "./protocol";

function socketPath(): string {
  const uid = typeof process.getuid === "function" ? process.getuid() : "unknown";
  return path.join(process.env.XDG_RUNTIME_DIR || os.tmpdir(), `pi-web-${uid}`, "live.sock");
}
function encode(value: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(value));
  if (!payload.length || payload.length > LIVE_LIMITS.maxFrameBytes) throw new Error("Invalid Live Hub frame size");
  const frame = Buffer.allocUnsafe(payload.length + 4); frame.writeUInt32BE(payload.length); payload.copy(frame, 4); return frame;
}
function decoder(onMessage: (value: Record<string, unknown>) => void) {
  let buffered: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  return (chunk: Uint8Array) => {
    buffered = buffered.length ? Buffer.concat([buffered, chunk]) : Buffer.from(chunk);
    while (buffered.length >= 4) {
      const length = buffered.readUInt32BE(0);
      if (!length || length > LIVE_LIMITS.maxFrameBytes) throw new Error("Invalid Live Hub frame size");
      if (buffered.length < length + 4) return;
      const value = JSON.parse(buffered.subarray(4, length + 4).toString("utf8")); buffered = buffered.subarray(length + 4);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Live Hub response");
      onMessage(value as Record<string, unknown>);
    }
  };
}

export class LiveHubError extends Error { constructor(public code: string, message: string) { super(message); } }

export function hubRequest<T>(message: Record<string, unknown>, timeoutMs = 1500): Promise<T> {
  if (process.platform === "win32") return Promise.reject(new LiveHubError("unsupported", "Live Integration is not supported on Windows"));
  const requestId = randomUUID();
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath()); let settled = false;
    const finish = (error?: Error, value?: T) => { if (settled) return; settled = true; clearTimeout(timer); socket.destroy(); if (error) reject(error); else resolve(value as T); };
    const timer = setTimeout(() => finish(new LiveHubError("unavailable", "Live Hub request timed out")), timeoutMs); timer.unref();
    const decode = decoder((frame) => {
      if (frame.type !== "response" || frame.requestId !== requestId) return;
      if (frame.ok) finish(undefined, frame.data as T);
      else { const error = frame.error as { code?: string; message?: string } | undefined; finish(new LiveHubError(error?.code ?? "hub_error", error?.message ?? "Live Hub request failed")); }
    });
    socket.once("connect", () => socket.write(encode({ ...message, requestId })));
    socket.on("data", (chunk) => { try { decode(typeof chunk === "string" ? Buffer.from(chunk) : chunk); } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); } });
    socket.once("error", (error) => finish(new LiveHubError("unavailable", error.message)));
  });
}

export async function getObservedSession(sessionId: string): Promise<{ presence: LivePresence; snapshot: AttachmentSnapshot } | null> {
  try { return await hubRequest({ type: "session", sessionId }); } catch { return null; }
}
export async function getObservedPresence(): Promise<LivePresence[]> {
  try { return (await hubRequest<{ sessions: LivePresence[] }>({ type: "presence" })).sessions; } catch { return []; }
}
export function sendObservedCommand<T>(sessionId: string, clientId: string, commandId: string, command: Record<string, unknown>): Promise<T> {
  return hubRequest({ type: "command", sessionId, clientId, commandId, command }, 30_000);
}

export function subscribeHub(onMessage: (message: Record<string, unknown>) => void): () => void {
  if (process.platform === "win32") return () => {};
  const socket = net.createConnection(socketPath()); const requestId = randomUUID();
  const decode = decoder((frame) => {
    if (frame.type === "push" && frame.message && typeof frame.message === "object") onMessage(frame.message as Record<string, unknown>);
    else if (frame.type === "response" && frame.requestId === requestId && frame.data && typeof frame.data === "object") {
      const sessions = (frame.data as { sessions?: unknown }).sessions;
      if (Array.isArray(sessions)) onMessage({ type: "presence", sessions });
    }
  });
  socket.once("connect", () => socket.write(encode({ type: "subscribe", requestId })));
  socket.on("data", (chunk) => { try { decode(typeof chunk === "string" ? Buffer.from(chunk) : chunk); } catch { socket.destroy(); } });
  socket.on("error", () => {});
  return () => socket.destroy();
}

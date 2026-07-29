import net from "node:net";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

const VERSION = { piVersion: "0.82.1", piWebVersion: "0.8.2", companionVersion: "1.0.0", protocolVersion: 1 };
const MAX_FRAME = 16 * 1024 * 1024;
const MAX_IMAGES = 10;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const DEDUPE_MAX = 256;
const DEDUPE_MS = 15 * 60_000;
const SOCKET = path.join(process.env.XDG_RUNTIME_DIR || os.tmpdir(), `pi-web-${process.getuid?.() ?? "unknown"}`, "live.sock");
const CAPABILITIES = ["prompt", "steer", "follow_up", "abort", "abort_and_send", "set_model", "set_thinking_level", "get_tools", "set_tools", "get_commands", "get_state", "set_session_name", "compact"];
const singletonKey = Symbol.for("pi-web.companion.v1");

function encode(value: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(value));
  if (!payload.length || payload.length > MAX_FRAME) throw new Error("Pi Web Companion frame exceeds 16 MiB");
  const frame = Buffer.allocUnsafe(payload.length + 4); frame.writeUInt32BE(payload.length); payload.copy(frame, 4); return frame;
}
function decoder(onMessage: (message: any) => void) {
  let buffered: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  return (chunk: Uint8Array) => {
    buffered = buffered.length ? Buffer.concat([buffered, chunk]) : Buffer.from(chunk);
    while (buffered.length >= 4) {
      const length = buffered.readUInt32BE(0);
      if (!length || length > MAX_FRAME) throw new Error("Invalid Pi Web Companion frame");
      if (buffered.length < length + 4) return;
      const value = JSON.parse(buffered.subarray(4, length + 4).toString("utf8")); buffered = buffered.subarray(length + 4);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Pi Web Companion message");
      onMessage(value);
    }
  };
}
function imageBytes(data: string): number { return data.length % 4 ? -1 : (data.length / 4) * 3 - (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0); }
function validateImages(images: unknown): any[] {
  if (images === undefined) return [];
  if (!Array.isArray(images) || images.length > MAX_IMAGES) throw new Error(`At most ${MAX_IMAGES} images are allowed`);
  return images.map((image: any) => {
    if (!image || image.type !== "image" || typeof image.data !== "string" || typeof image.mimeType !== "string" || !image.mimeType.startsWith("image/")) throw new Error("Invalid image attachment");
    const bytes = imageBytes(image.data); if (bytes < 0 || bytes > MAX_IMAGE_BYTES || !/^[A-Za-z0-9+/]*={0,2}$/.test(image.data)) throw new Error("Invalid or oversized image attachment");
    return { type: "image", source: { type: "base64", mediaType: image.mimeType, data: image.data } };
  });
}

class Bridge {
  instanceId = randomUUID(); socket: net.Socket | null = null; reconnect = 250; timer: NodeJS.Timeout | null = null;
  generation = 0; runId = 0; runBaseLeaf: string | null = null; runBaseEntryCount = 0; current: any = null; pi: any = null; ctx: any = null;
  results = new Map<string, { at: number; result: any }>(); commandChain = Promise.resolve(); notifiedConflict = false;
  send(message: unknown) { if (this.socket?.writable) try { this.socket.write(encode(message)); } catch {} }
  connect() {
    if (this.socket || !this.ctx) return;
    const socket = net.createConnection(SOCKET); this.socket = socket; const decode = decoder((message) => this.receive(message));
    socket.once("connect", () => { this.reconnect = 250; this.send({ type: "hello", version: VERSION, instanceId: this.instanceId, pid: process.pid }); });
    socket.on("data", (chunk) => { try { decode(typeof chunk === "string" ? Buffer.from(chunk) : chunk); } catch { socket.destroy(); } });
    socket.on("error", () => {}); socket.on("close", () => { if (this.socket === socket) this.socket = null; this.schedule(); });
  }
  schedule() { if (this.timer || !this.ctx) return; const wait = Math.min(30_000, this.reconnect) * (0.75 + Math.random() * 0.5); this.reconnect = Math.min(30_000, this.reconnect * 2); this.timer = setTimeout(() => { this.timer = null; this.connect(); }, wait); this.timer.unref(); }
  bind(pi: any, ctx: any) { this.pi = pi; this.ctx = ctx; this.generation++; this.runId = 0; this.runBaseLeaf = null; this.snapshot(); this.connect(); }
  snapshot() {
    if (!this.ctx) return;
    const sm = this.ctx.sessionManager; const sessionFile = sm.getSessionFile();
    const entries = sm.getEntries();
    const persistedRunMessages = entries.slice(this.runBaseEntryCount).filter((entry: any) => entry.type === "message").length;
    const liveMessages = (this.current?.messages || []).slice(persistedRunMessages);
    this.current = { instanceId: this.instanceId, pid: process.pid, generation: this.generation, sessionId: sessionFile ? sm.getSessionId() : undefined,
      sessionFile, cwd: this.ctx.cwd, leafId: sm.getLeafId(), entryCount: entries.length, runId: this.runId, baseLeafId: this.runBaseLeaf, baseEntryCount: this.runBaseEntryCount,
      busy: !this.ctx.isIdle(), messages: liveMessages, capabilities: CAPABILITIES,
      state: { thinkingLevel: this.pi.getThinkingLevel(), tools: this.pi.getActiveTools(), model: this.ctx.model ? { provider: this.ctx.model.provider, id: this.ctx.model.id } : undefined } };
    this.send({ type: "snapshot", snapshot: this.current });
  }
  event(event: any, ctx: any) {
    // Pi creates a fresh ExtensionContext wrapper for each event. The
    // SessionManager is the stable session-scoped identity shared by them.
    if (ctx.sessionManager !== this.ctx?.sessionManager) return;
    if (event.type === "agent_start") { this.runId++; this.runBaseLeaf = ctx.sessionManager.getLeafId(); this.runBaseEntryCount = ctx.sessionManager.getEntries().length; this.current.messages = []; }
    if (["message_start", "message_update", "message_end"].includes(event.type) && event.message) {
      const message = event.message; const index = this.current.messages.findIndex((m: any) => m.role === message.role && message.role === "assistant");
      if (index >= 0) this.current.messages[index] = message; else this.current.messages.push(message);
    }
    this.send({ type: "event", instanceId: this.instanceId, generation: this.generation, runId: this.runId, event });
    if (event.type === "agent_settled") { this.snapshot(); this.invalidate("all"); }
    else if (event.type === "message_end") this.invalidate("messages");
  }
  invalidate(scope: string) { if (this.current?.sessionId) this.send({ type: "invalidation", instanceId: this.instanceId, generation: this.generation, sessionId: this.current.sessionId, scope }); }
  receive(message: any) {
    if (message.type === "hello_ok" || message.type === "request_snapshot") this.snapshot();
    if (message.type === "hello_error") this.ctx?.ui.notify(`Pi Web Live Integration disabled: ${message.message}`, "warning");
    if (message.type === "attachment_result" && !message.accepted && !this.notifiedConflict) { this.notifiedConflict = true; this.ctx?.ui.notify(message.reason, "warning"); }
    if (message.type === "attachment_result" && message.accepted) this.notifiedConflict = false;
    if (message.type === "command") this.commandChain = this.commandChain.then(() => this.command(message)).catch(() => {});
  }
  async command(message: any) {
    const cached = this.results.get(message.commandId); if (cached && Date.now() - cached.at < DEDUPE_MS) return this.send(cached.result);
    let response: any;
    try {
      if (message.sessionId !== this.current?.sessionId) throw new Error("Session attachment changed");
      const c = message.command; let result: unknown = null; const images = validateImages(c.images);
      if (c.type === "prompt") { if (!this.ctx.isIdle()) throw new Error("Runtime is busy; choose Steer, Follow-up, or Abort and Send"); this.pi.sendUserMessage(images.length ? [...(c.message ? [{ type: "text", text: c.message }] : []), ...images] : c.message); }
      else if (c.type === "steer" || c.type === "follow_up") this.pi.sendUserMessage(images.length ? [...(c.message ? [{ type: "text", text: c.message }] : []), ...images] : c.message, { deliverAs: c.type === "steer" ? "steer" : "followUp" });
      else if (c.type === "abort") this.ctx.abort();
      else if (c.type === "abort_and_send") { this.ctx.abort(); while (!this.ctx.isIdle()) await new Promise((r) => setTimeout(r, 25)); this.pi.sendUserMessage(images.length ? [...(c.message ? [{ type: "text", text: c.message }] : []), ...images] : c.message); }
      else if (c.type === "set_model") { const model = this.ctx.modelRegistry.find(c.provider, c.modelId); if (!model || !(await this.pi.setModel(model))) throw new Error("Model unavailable or missing credentials"); }
      else if (c.type === "set_thinking_level") this.pi.setThinkingLevel(c.level);
      else if (c.type === "get_tools") result = this.pi.getAllTools().map((t: any) => ({ name: t.name, description: t.description, active: this.pi.getActiveTools().includes(t.name) }));
      else if (c.type === "set_tools") this.pi.setActiveTools(c.toolNames);
      else if (c.type === "get_commands") result = { commands: this.pi.getCommands() };
      else if (c.type === "get_state") { this.snapshot(); result = this.current.state; }
      else if (c.type === "set_session_name") this.pi.setSessionName(c.name);
      else if (c.type === "compact") this.ctx.compact({ onComplete: () => this.invalidate("all"), onError: () => this.invalidate("all") });
      else throw new Error(`Unsupported command: ${c.type}`);
      response = { type: "command_result", instanceId: this.instanceId, commandId: message.commandId, ok: true, result };
    } catch (error) { response = { type: "command_result", instanceId: this.instanceId, commandId: message.commandId, ok: false, error: error instanceof Error ? error.message : String(error) }; }
    this.results.set(message.commandId, { at: Date.now(), result: response });
    while (this.results.size > DEDUPE_MAX) this.results.delete(this.results.keys().next().value!);
    for (const [id, item] of this.results) if (Date.now() - item.at > DEDUPE_MS) this.results.delete(id);
    this.send(response);
  }
}

export default function companion(pi: any) {
  let enabled = false; const bridge: Bridge = (globalThis as any)[singletonKey] ||= new Bridge();
  pi.on("session_start", (_event: any, ctx: any) => { enabled = ctx.mode === "tui"; if (enabled) bridge.bind(pi, ctx); });
  for (const type of ["agent_start", "agent_end", "agent_settled", "message_start", "message_update", "message_end", "tool_execution_start", "tool_execution_update", "tool_execution_end", "turn_start", "turn_end", "model_select", "thinking_level_select"])
    pi.on(type, (event: any, ctx: any) => { if (enabled && ctx.mode === "tui") bridge.event(event, ctx); });
  pi.on("session_info_changed", (_event: any, ctx: any) => { if (enabled && ctx.mode === "tui") bridge.invalidate("metadata"); });
  pi.on("session_compact", (_event: any, ctx: any) => { if (enabled && ctx.mode === "tui") bridge.invalidate("all"); });
  pi.on("session_tree", (_event: any, ctx: any) => { if (enabled && ctx.mode === "tui") { bridge.snapshot(); bridge.invalidate("tree"); } });
  pi.on("user_bash", (_event: any, ctx: any) => { if (enabled && ctx.mode === "tui") bridge.invalidate("messages"); });
}

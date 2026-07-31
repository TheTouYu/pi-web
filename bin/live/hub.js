#!/usr/bin/env node
"use strict";

const fs = require("fs");
const net = require("net");
const { randomUUID } = require("crypto");
const { encodeFrame, createFrameDecoder } = require("./framing");
const { getLivePaths, assertSafeDirectory, assertSafeNode } = require("./paths");
const C = require("./constants");

const paths = getLivePaths();
const instances = new Map();
const claims = new Map();
const subscribers = new Set();
const pendingCommands = new Map();
const controls = new Map();
const explicitContinuationRequired = new Set();
let lastPresenceSnapshot = "";
let lockFd;
let server;

function versionMatches(v) {
  return v && v.piVersion === C.PI_VERSION && v.piWebVersion === C.PI_WEB_VERSION
    && v.companionVersion === C.COMPANION_VERSION && v.protocolVersion === C.HUB_PROTOCOL_VERSION;
}
function send(socket, message) { if (!socket.destroyed) socket.write(encodeFrame(message)); }
function presence() {
  return [...claims.values()].filter((claim) => claim.kind !== "web").map((claim) => ({
    sessionId: claim.sessionId, instanceId: claim.instanceId, generation: claim.generation,
    runId: claim.snapshot.runId, leafId: claim.snapshot.leafId, baseLeafId: claim.snapshot.baseLeafId,
    connected: claim.connected, reserved: !claim.connected, busy: claim.connected && claim.snapshot.busy,
    interrupted: !claim.connected, capabilities: claim.snapshot.capabilities, pid: claim.pid,
  }));
}
function publish(message) {
  const frame = encodeFrame({ type: "push", message });
  for (const sub of subscribers) {
    if (sub.destroyed || sub.writableLength + frame.length > C.MAX_BROWSER_QUEUE_BYTES) {
      sub.destroy(new Error("Live subscriber queue limit exceeded"));
    } else sub.write(frame);
  }
}
function publishPresence() {
  const sessions = presence();
  const snapshot = JSON.stringify(sessions);
  if (snapshot === lastPresenceSnapshot) return;
  lastPresenceSnapshot = snapshot;
  publish({ type: "presence", sessions });
}
function releaseClaim(claim, requireExplicit = false) {
  if (claim.reservationTimer) clearTimeout(claim.reservationTimer);
  if (requireExplicit) explicitContinuationRequired.add(claim.sessionId);
  for (const [token, control] of controls) if (control.sessionId === claim.sessionId) controls.delete(token);
  claims.delete(claim.sessionId);
  publish({ type: "claim_released", sessionId: claim.sessionId });
  publishPresence();
  for (const candidate of instances.values()) {
    if (candidate.snapshot?.sessionId === claim.sessionId && candidate.rejected) {
      candidate.rejected = false;
      attach(candidate, candidate.snapshot);
      break;
    }
  }
}
function attach(instance, snapshot) {
  const oldSessionId = instance.snapshot?.sessionId;
  instance.snapshot = snapshot;
  if (oldSessionId && oldSessionId !== snapshot.sessionId) {
    const old = claims.get(oldSessionId);
    if (old?.instanceId === instance.instanceId) releaseClaim(old);
  }
  if (!snapshot.sessionId || !snapshot.sessionFile) return;
  const existing = claims.get(snapshot.sessionId);
  if (existing && (existing.kind === "web" || existing.instanceId !== instance.instanceId)) {
    instance.rejected = true;
    send(instance.socket, { type: "attachment_result", generation: snapshot.generation, accepted: false,
      reason: "Another Pi runtime is already integrated with this Session Record. This does not prevent this terminal from using the file outside integration." });
    return;
  }
  const claim = existing || { kind: "observed", sessionId: snapshot.sessionId, instanceId: instance.instanceId, pid: instance.pid };
  if (claim.reservationTimer) clearTimeout(claim.reservationTimer);
  Object.assign(claim, { generation: snapshot.generation, snapshot, connected: true, pid: instance.pid, socket: instance.socket, reservationTimer: null });
  claims.set(snapshot.sessionId, claim);
  send(instance.socket, { type: "attachment_result", generation: snapshot.generation, accepted: true });
  publish({ type: "snapshot", sessionId: snapshot.sessionId, snapshot });
  publish({ type: "invalidation", sessionId: snapshot.sessionId, scope: "all" });
  publishPresence();
}
function disconnect(instance) {
  if (!instance) return;
  instance.connected = false;
  const claim = instance.snapshot?.sessionId ? claims.get(instance.snapshot.sessionId) : null;
  if (!claim || claim.instanceId !== instance.instanceId) return;
  claim.connected = false;
  claim.snapshot = instance.snapshot;
  claim.reservationTimer = setTimeout(() => releaseClaim(claim, true), C.DISCONNECT_RESERVATION_MS);
  claim.reservationTimer.unref();
  publish({ type: "interrupted", sessionId: claim.sessionId, snapshot: claim.snapshot });
  publishPresence();
}
function companionMessage(socket, state, message) {
  if (!state.instance) {
    if (message.type !== "hello" || !versionMatches(message.version) || typeof message.instanceId !== "string") {
      send(socket, { type: "hello_error", code: "version_mismatch", message: "Pi/Companion/Hub versions must match exactly" });
      return socket.end();
    }
    const previous = instances.get(message.instanceId);
    if (previous?.socket && previous.socket !== socket) previous.socket.destroy();
    state.instance = { instanceId: message.instanceId, pid: message.pid, socket, connected: true, snapshot: previous?.snapshot, rejected: false };
    instances.set(message.instanceId, state.instance);
    send(socket, { type: "hello_ok" });
    return;
  }
  const instance = state.instance;
  if (message.instanceId && message.instanceId !== instance.instanceId) return socket.destroy();
  if (message.type === "snapshot") return attach(instance, message.snapshot);
  if (message.type === "event") {
    const claim = instance.snapshot?.sessionId ? claims.get(instance.snapshot.sessionId) : null;
    if (!claim || claim.instanceId !== instance.instanceId || message.generation !== claim.generation) return;
    claim.snapshot.runId = message.runId;
    if (message.event.type === "agent_start") claim.snapshot.busy = true;
    if (message.event.type === "agent_settled") claim.snapshot.busy = false;
    publish({ type: "event", sessionId: claim.sessionId, generation: claim.generation, runId: message.runId, event: message.event });
    publishPresence();
    return;
  }
  if (message.type === "invalidation") {
    const claim = claims.get(message.sessionId);
    if (claim?.instanceId === instance.instanceId && claim.generation === message.generation) publish(message);
    return;
  }
  if (message.type === "command_result") {
    const pending = pendingCommands.get(message.commandId);
    if (pending) { pendingCommands.delete(message.commandId); pending(message); }
  }
}
function clientRequest(socket, message) {
  if (message.type === "subscribe") {
    subscribers.add(socket); send(socket, { type: "response", requestId: message.requestId, ok: true, data: { sessions: presence() } }); return;
  }
  let data;
  if (message.type === "health") data = { healthy: true, pid: process.pid, version: C.HUB_PROTOCOL_VERSION };
  else if (message.type === "presence") data = { sessions: presence() };
  else if (message.type === "session") {
    const claim = claims.get(message.sessionId); data = claim?.kind === "observed" ? { presence: presence().find((p) => p.sessionId === message.sessionId), snapshot: claim.snapshot } : null;
  } else if (message.type === "web_claim") {
    const existing = claims.get(message.sessionId);
    if (existing) return send(socket, { type: "response", requestId: message.requestId, ok: false, error: { code: "claimed", message: "Session Record already has an accepted runtime" } });
    if (explicitContinuationRequired.has(message.sessionId) && !message.explicit) return send(socket, { type: "response", requestId: message.requestId, ok: false, error: { code: "explicit_continuation_required", message: "Terminal reservation expired; explicitly choose Continue in Pi Web" } });
    if (message.explicit && Number.isInteger(message.observedPid) && message.observedPid > 0) {
      try {
        process.kill(message.observedPid, 0);
        return send(socket, { type: "response", requestId: message.requestId, ok: false, error: { code: "observed_process_alive", message: "The original terminal Pi process is still alive" } });
      } catch (error) {
        if (error?.code !== "ESRCH") return send(socket, { type: "response", requestId: message.requestId, ok: false, error: { code: "pid_unknown", message: "Unable to verify whether the original terminal Pi is still alive; high-risk confirmation is required" } });
      }
    }
    explicitContinuationRequired.delete(message.sessionId); claims.set(message.sessionId, { kind: "web", sessionId: message.sessionId, ownerId: message.ownerId }); data = { claimed: true };
  } else if (message.type === "web_release") {
    const claim = claims.get(message.sessionId); if (claim?.kind === "web" && claim.ownerId === message.ownerId) claims.delete(message.sessionId); data = { released: true };
  } else if (message.type === "control_acquire") {
    const claim = claims.get(message.sessionId);
    if (!claim?.connected) return send(socket, { type: "response", requestId: message.requestId, ok: false, error: { code: "unavailable", message: "Observed runtime is not connected" } });
    const token = randomUUID(); controls.set(token, { token, clientId: message.clientId, sessionId: message.sessionId, instanceId: claim.instanceId, generation: claim.generation, lastUsed: Date.now() });
    data = { token, instanceId: claim.instanceId, capabilities: claim.snapshot.capabilities, expiresInMs: C.CONTROL_IDLE_EXPIRY_MS };
  } else if (message.type === "control_release") {
    const control = controls.get(message.token); if (control?.clientId === message.clientId) controls.delete(message.token); data = { released: true };
  } else if (message.type === "command") {
    const claim = claims.get(message.sessionId);
    if (!claim) return send(socket, { type: "response", requestId: message.requestId, ok: false, error: { code: "no_claim", message: "No observed runtime claim" } });
    const control = controls.get(message.controlToken);
    if (!control || control.clientId !== message.clientId || control.sessionId !== message.sessionId || control.instanceId !== claim.instanceId || control.generation !== claim.generation || Date.now() - control.lastUsed > C.CONTROL_IDLE_EXPIRY_MS) {
      if (control) controls.delete(message.controlToken);
      return send(socket, { type: "response", requestId: message.requestId, ok: false, error: { code: "control_required", message: "Enable Shared Control on this Live Session page" } });
    }
    control.lastUsed = Date.now();
    if (!claim.connected) return send(socket, { type: "response", requestId: message.requestId, ok: false, error: { code: "reserved", message: "Observed runtime is reconnecting" } });
    if (!claim.snapshot.capabilities.includes(message.command.type)) return send(socket, { type: "response", requestId: message.requestId, ok: false, error: { code: "unsupported", message: `Observed runtime does not support ${message.command.type}` } });
    const commandId = message.commandId || randomUUID();
    pendingCommands.set(commandId, (result) => send(socket, { type: "response", requestId: message.requestId, ok: result.ok, data: result.result, error: result.ok ? undefined : { code: "command_failed", message: result.error } }));
    send(claim.socket, { type: "command", commandId, sessionId: claim.sessionId, clientId: message.clientId, command: message.command });
    return;
  } else return send(socket, { type: "response", requestId: message.requestId, ok: false, error: { code: "bad_request", message: "Unsupported Hub request" } });
  send(socket, { type: "response", requestId: message.requestId, ok: true, data });
}
function connection(socket) {
  const state = { role: null, instance: null };
  const decode = createFrameDecoder((message) => {
    if (!state.role) {
      if (message.type === "hello") state.role = "companion";
      else state.role = "client";
    }
    if (state.role === "companion") companionMessage(socket, state, message); else clientRequest(socket, message);
  });
  socket.on("data", (chunk) => { try { decode(chunk); } catch { socket.destroy(); } });
  socket.on("close", () => { subscribers.delete(socket); disconnect(state.instance); });
  socket.on("error", () => {});
}
function cleanup() {
  try { server?.close(); } catch {}
  try { if (assertSafeNode(paths.socket)) fs.unlinkSync(paths.socket); } catch {}
  try { if (lockFd !== undefined) fs.closeSync(lockFd); } catch {}
  try { if (assertSafeNode(paths.lock)) fs.unlinkSync(paths.lock); } catch {}
}
function main() {
  assertSafeDirectory(paths.dir); assertSafeNode(paths.socket); assertSafeNode(paths.lock);
  try { lockFd = fs.openSync(paths.lock, "wx", 0o600); fs.writeFileSync(lockFd, JSON.stringify({ pid: process.pid })); }
  catch (error) { console.error(`[pi-web-live] Hub owner already exists: ${error.message}`); process.exit(2); }
  server = net.createServer(connection);
  server.on("error", (error) => { console.error(`[pi-web-live] ${error.message}`); cleanup(); process.exit(1); });
  server.listen(paths.socket, () => { fs.chmodSync(paths.socket, 0o600); if (process.send) process.send({ type: "ready" }); });
  process.once("SIGTERM", () => { cleanup(); process.exit(0); }); process.once("SIGINT", () => { cleanup(); process.exit(0); }); process.once("exit", cleanup);
}
main();

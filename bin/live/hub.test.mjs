import assert from "node:assert/strict";
import { fork } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { encodeFrame, createFrameDecoder } = require("./framing");
const C = require("./constants");

function waitFor(messages, predicate, timeout = 2000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      const match = messages.find(predicate);
      if (match) return resolve(match);
      if (Date.now() - started >= timeout) return reject(new Error("Timed out waiting for Hub message"));
      setTimeout(check, 10);
    };
    check();
  });
}

function connect(socketPath) {
  return new Promise((resolve, reject) => {
    const messages = [];
    const socket = net.createConnection(socketPath);
    const decode = createFrameDecoder((message) => messages.push(message));
    socket.on("data", decode);
    socket.once("connect", () => resolve({ socket, messages }));
    socket.once("error", reject);
  });
}

test("ordinary live events do not rebroadcast unchanged presence", async (t) => {
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-hub-test-"));
  const hub = fork(path.join(import.meta.dirname, "hub.js"), [], {
    env: { ...process.env, XDG_RUNTIME_DIR: runtime },
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  t.after(async () => {
    hub.kill("SIGTERM");
    if (hub.exitCode === null) await new Promise((resolve) => hub.once("exit", resolve));
    fs.rmSync(runtime, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    hub.once("message", resolve);
    hub.once("exit", (code) => reject(new Error(`Hub exited early: ${code}`)));
  });

  const socketPath = path.join(runtime, `pi-web-${process.getuid?.() ?? "unknown"}`, "live.sock");
  const companion = await connect(socketPath);
  t.after(() => companion.socket.destroy());
  companion.socket.write(encodeFrame({
    type: "hello",
    version: { piVersion: C.PI_VERSION, piWebVersion: C.PI_WEB_VERSION, companionVersion: C.COMPANION_VERSION, protocolVersion: C.HUB_PROTOCOL_VERSION },
    instanceId: "terminal-1",
    pid: process.pid,
  }));
  await waitFor(companion.messages, (message) => message.type === "hello_ok");
  const snapshot = {
    instanceId: "terminal-1", pid: process.pid, generation: 1, sessionId: "session-1", sessionFile: "/tmp/session-1.jsonl",
    cwd: "/tmp", leafId: null, entryCount: 0, runId: 0, baseLeafId: null, busy: false, messages: [], capabilities: [], state: {},
  };
  companion.socket.write(encodeFrame({ type: "snapshot", snapshot }));
  await waitFor(companion.messages, (message) => message.type === "attachment_result");

  const subscriber = await connect(socketPath);
  t.after(() => subscriber.socket.destroy());
  subscriber.socket.write(encodeFrame({ type: "subscribe", requestId: "subscribe-1" }));
  await waitFor(subscriber.messages, (message) => message.type === "response");
  subscriber.messages.length = 0;

  const event = (type) => ({ type: "event", instanceId: "terminal-1", generation: 1, runId: 1, event: { type } });
  companion.socket.write(Buffer.concat([
    encodeFrame(event("agent_start")),
    ...Array.from({ length: 5 }, () => encodeFrame(event("message_update"))),
  ]));
  await waitFor(subscriber.messages, (message) => message.type === "push" && message.message?.type === "presence");
  await waitFor(subscriber.messages, (message) => message.type === "push" && message.message?.type === "event" && message.message.event?.type === "message_update");
  await new Promise((resolve) => setTimeout(resolve, 50));

  const pushes = subscriber.messages.filter((message) => message.type === "push").map((message) => message.message.type);
  assert.equal(pushes.filter((type) => type === "event").length, 6);
  assert.equal(pushes.filter((type) => type === "presence").length, 1);
});

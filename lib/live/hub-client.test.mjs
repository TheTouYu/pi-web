import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { createJiti } from "jiti";

const require = createRequire(import.meta.url);
const { encodeFrame, createFrameDecoder } = require("../../bin/live/framing");

test("Hub subscriptions deliver the response presence snapshot", async (t) => {
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-hub-client-test-"));
  const socketDir = path.join(runtime, `pi-web-${process.getuid?.() ?? "unknown"}`);
  const socketPath = path.join(socketDir, "live.sock");
  fs.mkdirSync(socketDir, { recursive: true });
  const server = net.createServer((socket) => {
    const decode = createFrameDecoder((message) => socket.write(encodeFrame({
      type: "response",
      requestId: message.requestId,
      ok: true,
      data: { sessions: [{ sessionId: "busy-session", busy: true }] },
    })));
    socket.on("data", decode);
  });
  await new Promise((resolve, reject) => server.listen(socketPath, resolve).once("error", reject));
  t.after(() => {
    server.close();
    fs.rmSync(runtime, { recursive: true, force: true });
  });

  process.env.XDG_RUNTIME_DIR = runtime;
  const { subscribeHub } = await createJiti(import.meta.url).import("./hub-client.ts");
  const message = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for presence")), 1000);
    const unsubscribe = subscribeHub((value) => {
      clearTimeout(timer);
      unsubscribe();
      resolve(value);
    });
  });

  assert.deepEqual(message, { type: "presence", sessions: [{ sessionId: "busy-session", busy: true }] });
});

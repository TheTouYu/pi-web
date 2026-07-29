"use strict";

const net = require("net");
const { randomUUID } = require("crypto");
const { encodeFrame, createFrameDecoder } = require("./framing");
const { getLivePaths } = require("./paths");

function request(message, options = {}) {
  const socketPath = options.socketPath || getLivePaths().socket;
  const timeoutMs = options.timeoutMs ?? 1000;
  const requestId = message.requestId || randomUUID();
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    const timer = setTimeout(() => socket.destroy(new Error("Live Hub request timed out")), timeoutMs);
    timer.unref();
    const finish = (error, value) => { clearTimeout(timer); socket.destroy(); if (error) reject(error); else resolve(value); };
    const decode = createFrameDecoder((frame) => {
      if (frame.type !== "response" || frame.requestId !== requestId) return;
      if (frame.ok) finish(null, frame.data); else { const error = new Error(frame.error?.message || "Live Hub request failed"); error.code = frame.error?.code; finish(error); }
    });
    socket.once("connect", () => socket.write(encodeFrame({ ...message, requestId })));
    socket.on("data", (chunk) => { try { decode(chunk); } catch (error) { finish(error); } });
    socket.once("error", (error) => finish(error));
  });
}

module.exports = { request };

"use strict";

const { MAX_FRAME_BYTES } = require("./constants");

function encodeFrame(value, maxBytes = MAX_FRAME_BYTES) {
  const payload = Buffer.from(JSON.stringify(value), "utf8");
  if (payload.length === 0 || payload.length > maxBytes) {
    throw new Error(`Invalid frame length: ${payload.length}`);
  }
  const frame = Buffer.allocUnsafe(payload.length + 4);
  frame.writeUInt32BE(payload.length, 0);
  payload.copy(frame, 4);
  return frame;
}

function createFrameDecoder(onFrame, options = {}) {
  const maxBytes = options.maxBytes ?? MAX_FRAME_BYTES;
  let buffer = Buffer.alloc(0);
  return function decode(chunk) {
    if (!Buffer.isBuffer(chunk)) chunk = Buffer.from(chunk);
    buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;
    while (buffer.length >= 4) {
      const length = buffer.readUInt32BE(0);
      if (length === 0 || length > maxBytes) throw new Error(`Invalid frame length: ${length}`);
      if (buffer.length < length + 4) return;
      const payload = buffer.subarray(4, length + 4);
      buffer = buffer.subarray(length + 4);
      let value;
      try { value = JSON.parse(payload.toString("utf8")); }
      catch { throw new Error("Invalid frame JSON"); }
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Frame must contain an object");
      onFrame(value);
    }
  };
}

module.exports = { encodeFrame, createFrameDecoder };

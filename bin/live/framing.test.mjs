import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { encodeFrame, createFrameDecoder } = require("./framing");

test("length-prefixed decoder handles fragmented and combined frames", () => {
  const values = []; const decode = createFrameDecoder((value) => values.push(value));
  const bytes = Buffer.concat([encodeFrame({ type: "one" }), encodeFrame({ type: "two", n: 2 })]);
  decode(bytes.subarray(0, 3)); decode(bytes.subarray(3, 9)); decode(bytes.subarray(9));
  assert.deepEqual(values, [{ type: "one" }, { type: "two", n: 2 }]);
});

test("decoder rejects zero and oversized frames", () => {
  const zero = Buffer.alloc(4); const huge = Buffer.alloc(4); huge.writeUInt32BE(101);
  assert.throws(() => createFrameDecoder(() => {}, { maxBytes: 100 })(zero), /Invalid frame length/);
  assert.throws(() => createFrameDecoder(() => {}, { maxBytes: 100 })(huge), /Invalid frame length/);
});

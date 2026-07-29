import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const source = fs.readFileSync(path.join(import.meta.dirname, "useAgentSession.ts"), "utf8");

test("idle observed sessions subscribe before a future terminal run starts", () => {
  assert.match(source, /runtime\?:\s*"observed"\s*\|\s*"web"/);
  assert.match(source, /agentState\?\.runtime === "observed"/);
  assert.match(source, /void connectEvents\(session\.id\)/);
});

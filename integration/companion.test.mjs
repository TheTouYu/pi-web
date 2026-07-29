import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const source = fs.readFileSync(path.join(import.meta.dirname, "companion.ts"), "utf8");

test("Companion accepts fresh ExtensionContext wrappers for the attached session", () => {
  assert.doesNotMatch(source, /if \(ctx !== this\.ctx\) return;/);
  assert.match(source, /ctx\.sessionManager !== this\.ctx\?\.sessionManager/);
});

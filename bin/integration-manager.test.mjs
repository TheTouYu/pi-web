import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const manager = require("./integration-manager");
const pkgDir = path.join(import.meta.dirname, "..");

test("Companion installs atomically with an exact-version hash manifest", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-integration-"));
  const old = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = path.join(home, "agent");
  try {
    const installed = manager.install(pkgDir);
    assert.equal(installed.healthy, true);
    assert.equal(installed.manifest.piVersion, "0.82.1");
    assert.match(installed.manifest.artifactHash, /^sha256:[a-f0-9]{64}$/);
    assert.equal(manager.uninstall(pkgDir).installed, false);
  } finally {
    if (old === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = old;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

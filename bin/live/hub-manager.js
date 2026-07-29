"use strict";

const fs = require("fs");
const path = require("path");
const { fork } = require("child_process");
const { request } = require("./client");
const { getLivePaths, assertSafeDirectory, assertSafeNode } = require("./paths");

async function removeStaleNodes() {
  const paths = getLivePaths();
  assertSafeDirectory(paths.dir);
  try { await request({ type: "health" }, { timeoutMs: 500 }); return false; } catch {}
  const lockStat = assertSafeNode(paths.lock);
  if (lockStat) {
    try {
      const lock = JSON.parse(fs.readFileSync(paths.lock, "utf8"));
      if (Number.isInteger(lock.pid) && lock.pid > 0) {
        process.kill(lock.pid, 0);
        // The owner may still be between lock creation and socket readiness.
        return false;
      }
    } catch (error) {
      if (error?.code !== "ESRCH" && !(error instanceof SyntaxError)) throw error;
    }
  }
  for (const node of [paths.socket, paths.lock]) {
    const stat = assertSafeNode(node);
    if (stat) fs.unlinkSync(node);
  }
  return true;
}

async function startHub(pkgDir) {
  if (process.platform === "win32") return { owner: false, child: null, unsupported: true };
  const canOwn = await removeStaleNodes();
  if (!canOwn) return { owner: false, child: null };
  const child = fork(path.join(pkgDir, "bin", "live", "hub.js"), [], { stdio: ["ignore", "inherit", "inherit", "ipc"] });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Live Hub startup timed out")), 3000);
    child.once("message", (message) => { if (message?.type === "ready") { clearTimeout(timer); resolve(); } });
    child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Live Hub exited during startup (${code})`)); });
  });
  return { owner: true, child };
}

module.exports = { removeStaleNodes, startHub };

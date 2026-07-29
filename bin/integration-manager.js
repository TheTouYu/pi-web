"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const readline = require("readline");
const C = require("./live/constants");

function paths(pkgDir, env = process.env) {
  const agentDir = env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent");
  const target = path.join(agentDir, "extensions", "pi-web-companion");
  return { source: path.join(pkgDir, "integration", "companion.ts"), target, manifest: path.join(target, "manifest.json"), artifact: path.join(target, "index.ts") };
}
function hash(content) { return crypto.createHash("sha256").update(content).digest("hex"); }
function expectedManifest(content) {
  return { piVersion: C.PI_VERSION, piWebVersion: C.PI_WEB_VERSION, companionVersion: C.COMPANION_VERSION,
    hubProtocolVersion: C.HUB_PROTOCOL_VERSION, artifactHash: `sha256:${hash(content)}` };
}
function status(pkgDir) {
  if (process.platform === "win32") return { installed: false, supported: false, reason: "Live Integration is not supported on Windows" };
  const p = paths(pkgDir); let content, manifest;
  try { content = fs.readFileSync(p.artifact); manifest = JSON.parse(fs.readFileSync(p.manifest, "utf8")); }
  catch { return { installed: false, supported: true, target: p.target }; }
  const expected = expectedManifest(fs.readFileSync(p.source));
  const actualHash = `sha256:${hash(content)}`;
  const healthy = actualHash === manifest.artifactHash && Object.keys(expected).every((key) => manifest[key] === expected[key]);
  return { installed: true, supported: true, healthy, target: p.target, manifest };
}
function install(pkgDir) {
  if (process.platform === "win32") throw new Error("Live Integration is not supported on Windows");
  const p = paths(pkgDir); const content = fs.readFileSync(p.source); const manifest = expectedManifest(content);
  fs.mkdirSync(path.dirname(p.target), { recursive: true, mode: 0o700 });
  const temporary = `${p.target}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  const backup = `${p.target}.old-${process.pid}`;
  fs.mkdirSync(temporary, { mode: 0o700 });
  try {
    fs.writeFileSync(path.join(temporary, "index.ts"), content, { mode: 0o600 });
    fs.writeFileSync(path.join(temporary, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    if (fs.existsSync(p.target)) fs.renameSync(p.target, backup);
    fs.renameSync(temporary, p.target);
    if (fs.existsSync(backup)) fs.rmSync(backup, { recursive: true, force: true });
  } catch (error) {
    fs.rmSync(temporary, { recursive: true, force: true });
    if (!fs.existsSync(p.target) && fs.existsSync(backup)) fs.renameSync(backup, p.target);
    throw error;
  }
  return status(pkgDir);
}
function uninstall(pkgDir) {
  const p = paths(pkgDir); const current = status(pkgDir);
  if (!current.installed) return current;
  if (!current.healthy) throw new Error(`Refusing to remove modified Companion directory: ${p.target}`);
  const removed = `${p.target}.remove-${process.pid}`; fs.renameSync(p.target, removed); fs.rmSync(removed, { recursive: true });
  return status(pkgDir);
}
function confirmInstall(pkgDir) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return Promise.resolve(false);
  const p = paths(pkgDir);
  console.log("Pi Web can install its optional Companion Extension.");
  console.log(`It writes a self-contained extension to: ${p.target}`);
  console.log("It observes ordinary interactive Pi TUI sessions and enables optional shared web control; other Pi modes are unaffected.");
  console.log("Remove it with: pi-web integration uninstall. Already-running Pi processes must be restarted.");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question("Install now? [y/N] ", (answer) => { rl.close(); resolve(/^y(es)?$/i.test(answer.trim())); }));
}

module.exports = { status, install, uninstall, confirmInstall };

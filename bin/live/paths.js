"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

function getLivePaths(env = process.env) {
  const runtimeBase = env.XDG_RUNTIME_DIR || os.tmpdir();
  const uid = typeof process.getuid === "function" ? process.getuid() : "unknown";
  const dir = path.join(runtimeBase, `pi-web-${uid}`);
  return { dir, socket: path.join(dir, "live.sock"), lock: path.join(dir, "hub.lock") };
}

function assertSafeDirectory(dir) {
  if (process.platform === "win32") throw new Error("Live Integration is not supported on Windows");
  let stat;
  try { stat = fs.lstatSync(dir); } catch (error) {
    if (error.code !== "ENOENT") throw error;
    fs.mkdirSync(dir, { mode: 0o700 });
    stat = fs.lstatSync(dir);
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Unsafe Live Hub directory: ${dir}`);
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) throw new Error(`Live Hub directory has a different owner: ${dir}`);
  if ((stat.mode & 0o077) !== 0) fs.chmodSync(dir, 0o700);
}

function assertSafeNode(file) {
  try {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) throw new Error(`Refusing dangerous symlink: ${file}`);
    if (typeof process.getuid === "function" && stat.uid !== process.getuid()) throw new Error(`Live Hub node has a different owner: ${file}`);
    return stat;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

module.exports = { getLivePaths, assertSafeDirectory, assertSafeNode };

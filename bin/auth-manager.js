"use strict";
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
function target() { return path.join(process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent"), "pi-web-password.json"); }
function save(password) {
  if (password.length < 12) throw new Error("Administrator password must be at least 12 characters");
  const salt = crypto.randomBytes(16); const hash = crypto.scryptSync(password, salt, 64, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const file = target(); fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, JSON.stringify({ version: 1, salt: salt.toString("base64"), hash: hash.toString("base64"), changedAt: Date.now() }, null, 2) + "\n", { mode: 0o600 }); fs.renameSync(temporary, file); fs.chmodSync(file, 0o600);
}
function readHidden(prompt) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Password setup requires an interactive TTY");
  return new Promise((resolve) => { process.stdout.write(prompt); process.stdin.setRawMode(true); process.stdin.resume(); let value = "";
    const input = (data) => { const text = data.toString(); if (text === "\r" || text === "\n") { process.stdin.off("data", input); process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write("\n"); resolve(value); } else if (text === "\u0003") process.exit(130); else if (text === "\u007f") value = value.slice(0, -1); else value += text; };
    process.stdin.on("data", input);
  });
}
async function promptAndSave() { const first = await readHidden("New administrator password: "); const second = await readHidden("Confirm password: "); if (first !== second) throw new Error("Passwords do not match"); save(first); }
module.exports = { target, save, promptAndSave };

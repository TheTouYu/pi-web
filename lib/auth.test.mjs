import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const original = process.env.PI_CODING_AGENT_DIR;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-auth-"));
process.env.PI_CODING_AGENT_DIR = dir;
const auth = await import("./auth.ts");

test("passwords use scrypt and login cookies invalidate after password changes", () => {
  auth.setAdministratorPassword("correct horse battery staple");
  assert.equal(auth.verifyAdministratorPassword("correct horse battery staple"), true);
  assert.equal(auth.verifyAdministratorPassword("wrong password"), false);
  const cookie = auth.createLoginCookie(false).split(";", 1)[0];
  assert.equal(auth.isAuthenticatedCookie(cookie), true);
  auth.setAdministratorPassword("another secure administrator password");
  assert.equal(auth.isAuthenticatedCookie(cookie), false);
  assert.equal(fs.statSync(path.join(dir, "pi-web-password.json")).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.join(dir, "pi-web-login.key")).mode & 0o777, 0o600);
});

test.after(() => { if (original === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = original; fs.rmSync(dir, { recursive: true, force: true }); });

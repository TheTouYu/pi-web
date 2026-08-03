import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const COOKIE = "pi-web-session";
const LOGIN_ABSOLUTE_EXPIRY_MS = 7 * 24 * 60 * 60_000;
const authDir = () => process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent");
const passwordFile = () => path.join(authDir(), "pi-web-password.json");
const readonlyPasswordFile = () => path.join(authDir(), "pi-web-readonly-password.json");
const secretFile = () => path.join(authDir(), "pi-web-login.key");

export type AuthRole = "admin" | "readonly";
type PasswordRecord = { version: 1; salt: string; hash: string; changedAt: number };
type LoginPayload = { issuedAt: number; expiresAt: number; passwordChangedAt: number; nonce: string; role?: AuthRole };

function readRecord(): PasswordRecord | null {
  try { const value = JSON.parse(fs.readFileSync(passwordFile(), "utf8")); return value.version === 1 ? value : null; } catch { return null; }
}
function derive(password: string, salt: Buffer): Buffer { return crypto.scryptSync(password, salt, 64, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }); }
function atomicPrivateWrite(file: string, data: string | Buffer) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); const temporary = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  fs.writeFileSync(temporary, data, { mode: 0o600 }); fs.renameSync(temporary, file); fs.chmodSync(file, 0o600);
}
export function hasConfiguredPassword(): boolean { return !!readRecord() || !!process.env.PI_WEB_PASSWORD; }
export function setAdministratorPassword(password: string): void {
  if (password.length < 12) throw new Error("Administrator password must be at least 12 characters");
  const salt = crypto.randomBytes(16); const record: PasswordRecord = { version: 1, salt: salt.toString("base64"), hash: derive(password, salt).toString("base64"), changedAt: Date.now() };
  atomicPrivateWrite(passwordFile(), `${JSON.stringify(record, null, 2)}\n`);
}
export function verifyAdministratorPassword(password: string): boolean {
  const record = readRecord();
  if (!record) {
    const expected = process.env.PI_WEB_PASSWORD; if (!expected) return false;
    const left = Buffer.from(password); const right = Buffer.from(expected); return left.length === right.length && crypto.timingSafeEqual(left, right);
  }
  try { const actual = derive(password, Buffer.from(record.salt, "base64")); const expected = Buffer.from(record.hash, "base64"); return actual.length === expected.length && crypto.timingSafeEqual(actual, expected); } catch { return false; }
}
function readReadonlyRecord(): PasswordRecord | null {
  try { const value = JSON.parse(fs.readFileSync(readonlyPasswordFile(), "utf8")); return value.version === 1 ? value : null; } catch { return null; }
}
export function hasConfiguredReadonlyPassword(): boolean { return !!readReadonlyRecord() || !!process.env.PI_WEB_READONLY_PASSWORD; }
export function verifyReadonlyPassword(password: string): boolean {
  const record = readReadonlyRecord();
  if (!record) {
    const expected = process.env.PI_WEB_READONLY_PASSWORD; if (!expected) return false;
    const left = Buffer.from(password); const right = Buffer.from(expected); return left.length === right.length && crypto.timingSafeEqual(left, right);
  }
  try { const actual = derive(password, Buffer.from(record.salt, "base64")); const expected = Buffer.from(record.hash, "base64"); return actual.length === expected.length && crypto.timingSafeEqual(actual, expected); } catch { return false; }
}
function secret(): Buffer {
  try { return fs.readFileSync(secretFile()); } catch { const value = crypto.randomBytes(32); atomicPrivateWrite(secretFile(), value); return value; }
}
function changedAt(): number { return readRecord()?.changedAt ?? 0; }
function sign(data: string): string { return crypto.createHmac("sha256", secret()).update(data).digest("base64url"); }
export function createLoginCookie(secure: boolean, role: AuthRole = "admin"): string {
  const issuedAt = Date.now(); const payload: LoginPayload = { issuedAt, expiresAt: issuedAt + LOGIN_ABSOLUTE_EXPIRY_MS, passwordChangedAt: changedAt(), nonce: crypto.randomBytes(16).toString("base64url"), role };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${COOKIE}=${data}.${sign(data)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(LOGIN_ABSOLUTE_EXPIRY_MS / 1000)}${secure ? "; Secure" : ""}`;
}
export function clearLoginCookie(): string { return `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`; }
function readSession(cookieHeader: string | null): LoginPayload | null {
  const value = cookieHeader?.split(/;\s*/).find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1); if (!value) return null;
  const dot = value.lastIndexOf("."); if (dot < 1) return null; const data = value.slice(0, dot); const signature = value.slice(dot + 1);
  const actual = Buffer.from(signature); const expected = Buffer.from(sign(data)); if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  try { const payload = JSON.parse(Buffer.from(data, "base64url").toString()) as LoginPayload; return payload.expiresAt > Date.now() && payload.issuedAt <= Date.now() && payload.passwordChangedAt === changedAt() ? payload : null; } catch { return null; }
}
export function isAuthenticatedCookie(cookieHeader: string | null): boolean { return readSession(cookieHeader) !== null; }
/** 登录角色；旧 cookie（升级前签发）没有 role 字段，视为管理员。 */
export function cookieRole(cookieHeader: string | null): AuthRole | null {
  const session = readSession(cookieHeader);
  return session ? (session.role ?? "admin") : null;
}
export function authenticationEnabled(): boolean { return process.env.PI_WEB_AUTH_ENABLED === "1" || hasConfiguredPassword(); }

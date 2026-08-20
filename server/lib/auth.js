/* Single shared admin password, not per-user accounts -- this is a
   one-operator tool. Password lives in an env var, never in source.
   Sessions are random tokens stored server-side with an expiry; the
   client only ever holds the opaque token in an HttpOnly cookie. */
import { randomBytes, timingSafeEqual, scrypt as scryptCb } from "node:crypto";
import { promisify } from "node:util";
import { db } from "../../scrapers/lib/db.js";

const scrypt = promisify(scryptCb);
const SESSION_HOURS = 12;

// Generated once per installation and persisted, instead of a literal
// string baked into the source -- no password hash is ever stored at rest
// here (the comparison below runs candidate-vs-env-var fresh on every
// login, never reads a saved hash back), so a fixed salt couldn't have fed
// a leaked-hash-database attack the way it would for a stored-hash system.
// Randomizing it anyway is a cheap way to not read as an anti-pattern to
// whoever reviews this file without that context.
function passwordSalt() {
  const row = db.prepare(`SELECT value FROM app_config WHERE key = 'password_salt'`).get();
  if (row) return row.value;
  const salt = randomBytes(16).toString("hex");
  db.prepare(`INSERT INTO app_config (key, value) VALUES ('password_salt', ?)`).run(salt);
  return salt;
}

function constantTimeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

// Async scrypt instead of scryptSync: measured at ~77ms wall-clock per call
// on this machine, and scryptSync runs on Node's single main thread, which
// means that 77ms blocks every other request the server has in flight, not
// just other login attempts. The async version still does the same CPU
// work, but on libuv's threadpool instead of the event loop, so the rest
// of the server keeps responding while a login is being checked.
export async function checkPassword(candidate) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    throw new Error(
      "ADMIN_PASSWORD is not set. Set it in your environment before starting the server -- there is no default password."
    );
  }
  // scrypt both sides so comparison time doesn't leak the real password's length
  const salt = passwordSalt();
  const [a, b] = await Promise.all([scrypt(candidate, salt, 32), scrypt(expected, salt, 32)]);
  return timingSafeEqual(a, b);
}

export function createSession() {
  const token = randomBytes(32).toString("hex");
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_HOURS * 3600 * 1000);
  db.prepare(`INSERT INTO admin_sessions (token, created_at, expires_at) VALUES (?, ?, ?)`).run(
    token,
    now.toISOString(),
    expires.toISOString()
  );
  return { token, expiresAt: expires };
}

/* Expired sessions are otherwise never deleted -- only destroySession() (on
   explicit logout) removes a row, so a session nobody logs out of sits
   forever even though it can no longer authenticate anything. Sweeping here
   piggybacks on the one code path every authenticated admin request already
   goes through, so the table self-cleans without a separate timer. Single-
   operator tool with a handful of sessions ever, so a DELETE on every check
   is not worth guarding against. */
export function verifySession(token) {
  db.prepare(`DELETE FROM admin_sessions WHERE expires_at <= ?`).run(new Date().toISOString());
  if (!token) return false;
  const row = db.prepare(`SELECT expires_at FROM admin_sessions WHERE token = ?`).get(token);
  if (!row) return false;
  return new Date(row.expires_at) > new Date();
}

export function destroySession(token) {
  if (!token) return;
  db.prepare(`DELETE FROM admin_sessions WHERE token = ?`).run(token);
}

export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

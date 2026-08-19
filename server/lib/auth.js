/* Single shared admin password, not per-user accounts -- this is a
   one-operator tool. Password lives in an env var, never in source.
   Sessions are random tokens stored server-side with an expiry; the
   client only ever holds the opaque token in an HttpOnly cookie. */
import { randomBytes, timingSafeEqual, scryptSync } from "node:crypto";
import { db } from "../../scrapers/lib/db.js";

const SESSION_HOURS = 12;

function constantTimeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function checkPassword(candidate) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    throw new Error(
      "ADMIN_PASSWORD is not set. Set it in your environment before starting the server -- there is no default password."
    );
  }
  // scrypt both sides so comparison time doesn't leak the real password's length
  const salt = "prospectors-planner-admin";
  const a = scryptSync(candidate, salt, 32);
  const b = scryptSync(expected, salt, 32);
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

export function verifySession(token) {
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

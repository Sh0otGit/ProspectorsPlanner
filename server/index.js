/* Plain node:http server, no framework -- consistent with the rest of this
   project's "no build step, no dependencies" approach. Serves the static
   prototype/ site, the static admin/ pages, and a small JSON API for
   auth, the scraper, and reviews. Start with:
     ADMIN_PASSWORD=yourpassword node server/index.js
   There is no default password; the server refuses admin logins without
   ADMIN_PASSWORD set. */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "../scrapers/lib/db.js";
import { checkPassword, createSession, verifySession, destroySession, parseCookies } from "./lib/auth.js";
import {
  triggerScheduleRun,
  triggerEvaluationsRun,
  lastRun,
  nextAutoRunAt,
  isRunning,
  startAutoScheduler,
  SCHEDULE_INTERVAL_HOURS,
  EVALUATIONS_INTERVAL_DAYS,
} from "./lib/scheduler.js";

const PORT = process.env.PORT || 8420;
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PROTOTYPE_DIR = join(ROOT, "prototype");
const ADMIN_DIR = join(ROOT, "server", "admin");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

async function serveStatic(res, rootDir, urlPath) {
  const safePath = normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(rootDir, safePath === "/" ? "index.html" : safePath);
  if (!filePath.startsWith(rootDir)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  try {
    const s = await stat(filePath);
    const finalPath = s.isDirectory() ? join(filePath, "index.html") : filePath;
    const body = await readFile(finalPath);
    res.writeHead(200, { "Content-Type": MIME[extname(finalPath)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("Not found");
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

function getSessionToken(req) {
  return parseCookies(req.headers.cookie).admin_session;
}

function requireAuth(req, res) {
  const token = getSessionToken(req);
  if (!verifySession(token)) {
    sendJson(res, 401, { error: "Not authenticated" });
    return false;
  }
  return true;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;

  try {
    // ---- public API: reviews submission (the "Rate this tool" card) ----
    if (pathname === "/api/reviews" && req.method === "POST") {
      const body = await readJsonBody(req);
      const rating = parseInt(body.rating, 10);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        return sendJson(res, 400, { error: "rating must be 1-5" });
      }
      db.prepare(`INSERT INTO reviews (rating, name, text, submitted_at) VALUES (?, ?, ?, ?)`).run(
        rating,
        String(body.name || "").slice(0, 200),
        String(body.text || "").slice(0, 4000),
        new Date().toISOString()
      );
      return sendJson(res, 201, { ok: true });
    }

    // ---- admin auth ----
    if (pathname === "/admin/api/login" && req.method === "POST") {
      const body = await readJsonBody(req);
      let ok;
      try {
        ok = checkPassword(String(body.password || ""));
      } catch (e) {
        return sendJson(res, 500, { error: e.message });
      }
      if (!ok) return sendJson(res, 401, { error: "Wrong password" });
      const { token, expiresAt } = createSession();
      res.setHeader(
        "Set-Cookie",
        `admin_session=${token}; HttpOnly; Path=/; SameSite=Strict; Expires=${expiresAt.toUTCString()}`
      );
      return sendJson(res, 200, { ok: true });
    }
    if (pathname === "/admin/api/logout" && req.method === "POST") {
      destroySession(getSessionToken(req));
      res.setHeader("Set-Cookie", "admin_session=; HttpOnly; Path=/; Max-Age=0");
      return sendJson(res, 200, { ok: true });
    }

    // ---- admin API (session-protected) ----
    if (pathname === "/admin/api/status" && req.method === "GET") {
      if (!requireAuth(req, res)) return;
      return sendJson(res, 200, {
        schedule: {
          running: isRunning("schedule"),
          lastRun: lastRun("schedule"),
          nextAutoRunAt: nextAutoRunAt("schedule").toISOString(),
          autoIntervalHours: SCHEDULE_INTERVAL_HOURS,
        },
        evaluations: {
          running: isRunning("evaluations"),
          lastRun: lastRun("evaluations"),
          nextAutoRunAt: nextAutoRunAt("evaluations").toISOString(),
          autoIntervalDays: EVALUATIONS_INTERVAL_DAYS,
        },
      });
    }
    if (pathname === "/admin/api/rescrape-schedule" && req.method === "POST") {
      if (!requireAuth(req, res)) return;
      if (isRunning("schedule")) return sendJson(res, 409, { error: "A schedule scrape is already running." });
      triggerScheduleRun("manual").catch((e) => console.error("Manual schedule scrape failed:", e.message));
      return sendJson(res, 202, { ok: true, message: "Schedule scrape started." });
    }
    if (pathname === "/admin/api/rescrape-evaluations" && req.method === "POST") {
      if (!requireAuth(req, res)) return;
      if (isRunning("evaluations")) return sendJson(res, 409, { error: "An evaluations scrape is already running." });
      triggerEvaluationsRun("manual").catch((e) => console.error("Manual evaluations scrape failed:", e.message));
      return sendJson(res, 202, { ok: true, message: "Evaluations scrape started. This is a multi-hour job." });
    }
    if (pathname === "/admin/api/scrape-runs" && req.method === "GET") {
      if (!requireAuth(req, res)) return;
      const runs = db.prepare(`SELECT * FROM scrape_runs ORDER BY id DESC LIMIT 30`).all();
      return sendJson(res, 200, { runs });
    }
    if (pathname === "/admin/api/reviews" && req.method === "GET") {
      if (!requireAuth(req, res)) return;
      const reviews = db.prepare(`SELECT * FROM reviews ORDER BY id DESC LIMIT 500`).all();
      return sendJson(res, 200, { reviews });
    }

    // ---- admin static pages (session-protected, except the login page itself) ----
    if (pathname.startsWith("/admin")) {
      const isLoginPage = pathname === "/admin" || pathname === "/admin/" || pathname === "/admin/login.html";
      if (!isLoginPage && !verifySession(getSessionToken(req))) {
        res.writeHead(302, { Location: "/admin/login.html" });
        return res.end();
      }
      let sub = pathname.slice("/admin".length) || "/login.html";
      if (sub === "/") sub = "/login.html";
      return serveStatic(res, ADMIN_DIR, sub);
    }

    // ---- everything else: the public prototype site ----
    return serveStatic(res, PROTOTYPE_DIR, pathname);
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: "Internal error" });
  }
});

startAutoScheduler();
server.listen(PORT, () => {
  console.log(`Prospector's Planner listening on http://localhost:${PORT}`);
  console.log(`Admin panel at http://localhost:${PORT}/admin/login.html`);
  if (!process.env.ADMIN_PASSWORD) {
    console.warn("ADMIN_PASSWORD is not set -- admin login will fail until it is.");
  }
});

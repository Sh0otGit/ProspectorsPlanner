/* Plain node:http server, no framework -- consistent with the rest of this
   project's "no build step, no dependencies" approach. Serves the static
   prototype/ site, the static admin/ pages, and a small JSON API for
   auth, the scraper, and reviews. Start with:
     ADMIN_PASSWORD=yourpassword node server/index.js
   There is no default password; the server refuses admin logins without
   ADMIN_PASSWORD set. */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "../scrapers/lib/db.js";
import { checkPassword, createSession, verifySession, destroySession, parseCookies } from "./lib/auth.js";
import { isRateLimited, clientIp } from "./lib/rate-limit.js";
import { latestTerm, listCourses, getCourse } from "./lib/catalog.js";
import {
  triggerScheduleRun,
  triggerEvaluationsRun,
  triggerRmpRun,
  lastRun,
  nextAutoRunAt,
  isRunning,
  startAutoScheduler,
  SCHEDULE_INTERVAL_HOURS,
  EVALUATIONS_INTERVAL_DAYS,
  RMP_INTERVAL_DAYS,
} from "./lib/scheduler.js";

const PORT = process.env.PORT || 8420;
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PROTOTYPE_DIR = join(ROOT, "prototype");
const ADMIN_DIR = join(ROOT, "server", "admin");
const NOT_FOUND_PAGE = join(PROTOTYPE_DIR, "404.html");
const ERROR_PAGE = join(PROTOTYPE_DIR, "500.html");
const MAINTENANCE_PAGE = join(PROTOTYPE_DIR, "maintenance.html");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".woff2": "font/woff2",
};

// Text-ish types worth gzipping. Already-compressed formats (png, woff2,
// ico) get bigger, not smaller, if you gzip them again -- skip those.
const COMPRESSIBLE = new Set([
  "text/html; charset=utf-8",
  "text/css; charset=utf-8",
  "text/javascript; charset=utf-8",
  "application/json; charset=utf-8",
  "image/svg+xml",
  "text/plain; charset=utf-8",
  "application/xml; charset=utf-8",
]);

// A same-origin CSP that still allows what this site actually uses: the
// small inline <script> blocks a few pages carry (index.html's sample-data
// button, report.html's submit handler) -- a nonce-based CSP would be
// tighter but isn't worth the added complexity for a single-operator
// prototype. Fonts used to need fonts.googleapis.com/fonts.gstatic.com
// here too; both are self-hosted from /fonts now (see styles.css), so
// neither host needs an allowance anymore.
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join("; "),
};

// Sends `body` with gzip applied when the client says it accepts it and
// compression is actually worth it (skips tiny bodies and already-
// compressed formats). One place for every static/JSON response to go
// through instead of duplicating the accept-encoding check everywhere.
function sendBody(req, res, status, headers, body) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const acceptsGzip = /\bgzip\b/.test(req.headers["accept-encoding"] || "");
  if (acceptsGzip && buf.length > 1024 && COMPRESSIBLE.has(headers["Content-Type"])) {
    res.writeHead(status, { ...headers, "Content-Encoding": "gzip", Vary: "Accept-Encoding" });
    return res.end(gzipSync(buf));
  }
  res.writeHead(status, headers);
  res.end(buf);
}

// notFoundPage/errorPage: when set, a missing file or thrown error for an
// HTML-navigation request (empty or .html extension -- not a missing CSS/
// JS/image asset, which should stay a plain 404) serves that styled page
// instead of bare text, without changing the status code a caller sees.
async function serveStatic(req, res, rootDir, urlPath, { notFoundPage } = {}) {
  const safePath = normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(rootDir, safePath === "/" ? "index.html" : safePath);
  if (!filePath.startsWith(rootDir)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  try {
    let finalPath = filePath;
    let s = await stat(finalPath);
    if (s.isDirectory()) {
      finalPath = join(finalPath, "index.html");
      s = await stat(finalPath);
    }
    // No build step means no cache-busting hashed filenames -- a file can
    // change without its URL changing, so a blind max-age was the wrong
    // tool: "public, max-age=3600" (the first version of this) meant
    // anyone who loaded the site in the hour around a deploy kept getting
    // served their browser's own stale copy for up to an hour after the
    // server had already moved on -- confirmed for real, not theoretical,
    // when real instructor data shipped and a browser that had visited
    // shortly before kept showing the fabricated data it had cached.
    // "no-cache" (despite the name) still lets the browser keep the file --
    // it just has to send If-Modified-Since and get a real answer first,
    // so an unchanged file is still a cheap 304 instead of a full re-fetch,
    // but a changed one is never silently stale.
    const lastModified = s.mtime.toUTCString();
    const ifModifiedSince = req.headers["if-modified-since"];
    if (ifModifiedSince && Math.floor(new Date(ifModifiedSince).getTime() / 1000) >= Math.floor(s.mtimeMs / 1000)) {
      res.writeHead(304, { "Cache-Control": "no-cache", "Last-Modified": lastModified });
      return res.end();
    }
    const body = await readFile(finalPath);
    const contentType = MIME[extname(finalPath)] || "application/octet-stream";
    return sendBody(req, res, 200, { "Content-Type": contentType, "Cache-Control": "no-cache", "Last-Modified": lastModified }, body);
  } catch {
    const ext = extname(urlPath);
    if (notFoundPage && (ext === "" || ext === ".html")) {
      try {
        const body = await readFile(notFoundPage);
        return sendBody(req, res, 404, { "Content-Type": "text/html; charset=utf-8" }, body);
      } catch {
        /* fall through to the plain-text 404 below if the page itself is missing */
      }
    }
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
  // res.req is Node's own back-reference from a ServerResponse to the
  // IncomingMessage that produced it -- reading it here means every one of
  // this function's ~25 call sites stays sendJson(res, status, obj), none
  // of them need to start threading req through as a 4th argument just for
  // this to see the request's Accept-Encoding header.
  sendBody(res.req, res, status, { "Content-Type": "application/json; charset=utf-8" }, JSON.stringify(obj));
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

  for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);

  // Cheap, DB-free liveness check for a host's uptime monitor -- answers
  // even while MAINTENANCE_MODE is on, since that's about the app, not
  // whether the process itself is alive.
  if (pathname === "/healthz") {
    return sendJson(res, 200, { ok: true });
  }

  if (process.env.MAINTENANCE_MODE === "1" && !pathname.startsWith("/admin")) {
    try {
      const body = await readFile(MAINTENANCE_PAGE);
      res.writeHead(503, { "Content-Type": "text/html; charset=utf-8", "Retry-After": "120" });
      return res.end(body);
    } catch {
      res.writeHead(503).end("Down for maintenance.");
      return;
    }
  }

  try {
    // ---- public API: real course/instructor data, replacing prototype/js/data.js's
    // fabricated CATALOG (see server/lib/catalog.js for the matching/aggregation) ----
    if (pathname === "/api/term" && req.method === "GET") {
      const term = latestTerm();
      return sendJson(res, 200, { termCode: term?.term_code ?? null, termLabel: term?.term_label ?? null });
    }
    if (pathname === "/api/courses" && req.method === "GET") {
      const term = latestTerm();
      if (!term) return sendJson(res, 200, { term: null, courses: [] });
      return sendJson(res, 200, { term: term.term_label, courses: listCourses(term.term_code) });
    }
    if (pathname === "/api/course" && req.method === "GET") {
      const code = (url.searchParams.get("code") || "").trim();
      const sp = code.indexOf(" ");
      if (sp === -1) return sendJson(res, 400, { error: "code must look like 'CS 3350'" });
      const term = latestTerm();
      if (!term) return sendJson(res, 200, { code, title: null, term: null, professors: [] });
      const subject = code.slice(0, sp).toUpperCase();
      const courseNumber = code.slice(sp + 1).toUpperCase();
      const found = getCourse(term.term_code, subject, courseNumber);
      return sendJson(res, 200, {
        code,
        title: found?.title ?? null,
        term: term.term_label,
        professors: found?.professors ?? [],
      });
    }

    // ---- public API: reviews submission (the "Rate this tool" card) ----
    if (pathname === "/api/reviews" && req.method === "POST") {
      if (isRateLimited(clientIp(req))) return sendJson(res, 429, { error: "Too many requests, try again shortly." });
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

    // ---- public API: "report a problem" submission ----
    if (pathname === "/api/reports" && req.method === "POST") {
      if (isRateLimited(clientIp(req))) return sendJson(res, 429, { error: "Too many requests, try again shortly." });
      const body = await readJsonBody(req);
      // Honeypot: a hidden field real visitors never see or fill. A bot
      // filling every field in a scraped form fills this too -- respond
      // as if it worked so it doesn't learn to skip the field next time,
      // just don't actually store anything.
      if (String(body.website || "").trim()) return sendJson(res, 201, { ok: true });
      const text = String(body.text || "").trim();
      if (!text) return sendJson(res, 400, { error: "text is required" });
      db.prepare(`INSERT INTO problem_reports (page, email, text, submitted_at) VALUES (?, ?, ?, ?)`).run(
        String(body.page || "").slice(0, 200),
        String(body.email || "").slice(0, 200),
        text.slice(0, 4000),
        new Date().toISOString()
      );
      return sendJson(res, 201, { ok: true });
    }

    // ---- admin auth ----
    if (pathname === "/admin/api/login" && req.method === "POST") {
      const body = await readJsonBody(req);
      let ok;
      try {
        ok = await checkPassword(String(body.password || ""));
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
        rmp: {
          running: isRunning("rmp"),
          lastRun: lastRun("rmp"),
          nextAutoRunAt: nextAutoRunAt("rmp").toISOString(),
          autoIntervalDays: RMP_INTERVAL_DAYS,
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
    if (pathname === "/admin/api/rescrape-rmp" && req.method === "POST") {
      if (!requireAuth(req, res)) return;
      if (isRunning("rmp")) return sendJson(res, 409, { error: "An RMP scrape is already running." });
      triggerRmpRun("manual").catch((e) => console.error("Manual RMP scrape failed:", e.message));
      return sendJson(res, 202, { ok: true, message: "RMP scrape started." });
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
    if (pathname === "/admin/api/reports" && req.method === "GET") {
      if (!requireAuth(req, res)) return;
      const reports = db.prepare(`SELECT * FROM problem_reports ORDER BY id DESC LIMIT 500`).all();
      return sendJson(res, 200, { reports });
    }

    // ---- data browser: every scraped section, grouped client-side by
    // term/subject/course number since there's currently one term's worth
    // (a few thousand rows) -- small enough to ship whole and let the
    // browser's own search filter it instead of round-tripping per keystroke ----
    if (pathname === "/admin/api/data/classes" && req.method === "GET") {
      if (!requireAuth(req, res)) return;
      const sections = db
        .prepare(`SELECT * FROM sections ORDER BY term_code DESC, subject ASC, course_number ASC, section ASC LIMIT 20000`)
        .all();
      return sendJson(res, 200, { sections });
    }

    // ---- data browser: instructor search, one profile + all evaluations
    // on file at a time -- unlike classes this stays server-searched, since
    // a campus-wide backfill means "everyone" is a much bigger dump than
    // "everyone who taught this term" ----
    if (pathname === "/admin/api/data/instructors" && req.method === "GET") {
      if (!requireAuth(req, res)) return;
      const q = (url.searchParams.get("q") || "").trim().toLowerCase();
      if (q.length < 2) return sendJson(res, 200, { instructors: [] });
      // Every token has to appear *somewhere* across name/username/
      // department, not the query as one literal phrase -- the scraped
      // schedule stores instructors as Banner's "First Last", but this
      // table stores HB 2504's "Last, First". A phrase match would never
      // find "Mondragon, Oscar" from a search for "Oscar Mondragon" (see
      // the click-to-search handler in data.js), a token match does.
      const tokens = q.split(/\s+/).filter(Boolean).slice(0, 8);
      const clause = tokens.map(() => `(lower(name) LIKE ? OR lower(username) LIKE ? OR lower(department) LIKE ?)`).join(" AND ");
      const params = tokens.flatMap((t) => [`%${t}%`, `%${t}%`, `%${t}%`]);
      const rows = db
        .prepare(`SELECT * FROM instructors WHERE ${clause} ORDER BY name ASC LIMIT 30`)
        .all(...params);
      const evalsFor = db.prepare(`SELECT * FROM evaluations WHERE username = ? ORDER BY term_label DESC, course_code ASC`);
      const instructors = rows.map((r) => ({ ...r, evaluations: evalsFor.all(r.username) }));
      return sendJson(res, 200, { instructors });
    }

    // ---- admin static pages (session-protected, except the login page and
    // the CSS/JS/etc it needs to render itself) ----
    if (pathname.startsWith("/admin")) {
      const isLoginPage = pathname === "/admin" || pathname === "/admin/" || pathname === "/admin/login.html";
      // A visitor with no session yet is, by definition, everyone looking
      // at the login page -- gating its own stylesheet and script behind
      // the session it doesn't have yet meant they always 302'd to
      // login.html itself, and the browser tried (and refused) to apply
      // that HTML response as CSS. Assets carry no admin data themselves;
      // only the HTML pages and the /admin/api/* routes above need auth.
      const isAsset = extname(pathname) !== "" && extname(pathname) !== ".html";
      if (!isLoginPage && !isAsset && !verifySession(getSessionToken(req))) {
        res.writeHead(302, { Location: "/admin/login.html" });
        return res.end();
      }
      let sub = pathname.slice("/admin".length) || "/login.html";
      if (sub === "/") sub = "/login.html";
      return serveStatic(req, res, ADMIN_DIR, sub);
    }

    // ---- everything else: the public prototype site ----
    return serveStatic(req, res, PROTOTYPE_DIR, pathname, { notFoundPage: NOT_FOUND_PAGE });
  } catch (err) {
    console.error(err);
    // API callers need a real error status to react to; a page navigation
    // that throws gets the styled error page instead of raw JSON.
    if (pathname.startsWith("/api/") || pathname.startsWith("/admin/api/")) {
      return sendJson(res, 500, { error: "Internal error" });
    }
    try {
      const body = await readFile(ERROR_PAGE);
      res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
      res.end(body);
    } catch {
      res.writeHead(500).end("Internal error");
    }
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

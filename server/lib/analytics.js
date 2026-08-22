/* Anonymous engagement events -- see analytics_events in scrapers/lib/db.js
   for the table shape and the privacy reasoning. Aggregation happens here
   in plain JS after one bounded SELECT rather than with SQLite's JSON1
   functions (json_extract etc.) -- this project's row counts don't need
   it, and it avoids a dependency on which JSON1 build node:sqlite ships
   with. */
import { db } from "../../scrapers/lib/db.js";

const insertEvent = db.prepare(
  `INSERT INTO analytics_events (session_id, event_type, event_data, occurred_at) VALUES (?, ?, ?, ?)`
);

/* events: [{type, data, at}, ...], already size-capped by the caller
   (server/index.js's /api/events route). One transaction per batch so a
   whole page-unload's worth of events (a page_view_duration plus
   whatever interactions queued since the last flush) commits atomically. */
export function insertEvents(sessionId, events) {
  db.exec("BEGIN");
  try {
    for (const e of events) {
      insertEvent.run(
        sessionId,
        String(e?.type || "").slice(0, 64),
        JSON.stringify(e?.data ?? {}).slice(0, 2000),
        String(e?.at || new Date().toISOString())
      );
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

// Canonical order for the funnel view -- the four-step flow plus Start and
// Map, not sorted by volume, since a funnel's whole point is the order
// and where sessions drop off between one step and the next.
const FUNNEL_PAGES = ["index", "courses", "availability", "instructors", "schedule", "map"];

function topEntries(map, limit) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, n]) => ({ key, n }));
}

export function analyticsSummary(sinceDays = 30) {
  const since = new Date(Date.now() - sinceDays * 86400000).toISOString();
  const rows = db
    .prepare(`SELECT session_id, event_type, event_data, occurred_at FROM analytics_events WHERE occurred_at >= ?`)
    .all(since);

  const sessions = new Set();
  const pageViews = new Map(); // page -> count
  const pageSessions = new Map(); // page -> Set(session_id)
  const pageDurations = new Map(); // page -> {sum, n}
  const outboundLinks = new Map(); // href -> count
  let copyCrnCount = 0;
  let addToScheduleCount = 0;
  let routesTabViews = 0;

  for (const r of rows) {
    sessions.add(r.session_id);
    let data;
    try {
      data = JSON.parse(r.event_data || "{}");
    } catch {
      data = {};
    }
    switch (r.event_type) {
      case "page_view": {
        const page = data.page || "unknown";
        pageViews.set(page, (pageViews.get(page) || 0) + 1);
        if (!pageSessions.has(page)) pageSessions.set(page, new Set());
        pageSessions.get(page).add(r.session_id);
        break;
      }
      case "page_view_duration": {
        const page = data.page || "unknown";
        const d = pageDurations.get(page) || { sum: 0, n: 0 };
        const ms = Number(data.durationMs) || 0;
        if (ms > 0 && ms < 3600000) { d.sum += ms; d.n += 1; } // drop 0/garbage/hour+ outliers (a tab left open overnight)
        pageDurations.set(page, d);
        break;
      }
      case "copy_crn":
        copyCrnCount++;
        break;
      case "add_to_schedule":
        addToScheduleCount++;
        break;
      case "outbound_link": {
        const href = String(data.href || "unknown").slice(0, 200);
        outboundLinks.set(href, (outboundLinks.get(href) || 0) + 1);
        break;
      }
      case "map_tab":
        if (data.tab === "routes") routesTabViews++;
        break;
    }
  }

  return {
    sinceDays,
    totalEvents: rows.length,
    totalSessions: sessions.size,
    funnel: FUNNEL_PAGES.map((page) => ({ page, sessions: pageSessions.get(page)?.size || 0 })),
    pageViews: topEntries(pageViews, 20),
    avgDurationMsByPage: [...pageDurations.entries()]
      .map(([page, d]) => ({ page, avgMs: d.n ? Math.round(d.sum / d.n) : 0, n: d.n }))
      .sort((a, b) => b.avgMs - a.avgMs),
    copyCrnCount,
    addToScheduleCount,
    outboundLinks: topEntries(outboundLinks, 20),
    routesTabViews,
  };
}

/* Two independent auto-schedules, each checked against its own last
   completed run in SQLite (not an in-memory timer, so a restart doesn't
   reset the countdown):
     - schedule: every 24 hours -- rooms/times/instructors can change
       during add/drop.
     - evaluations: every ~120 days (roughly a semester) -- HB 2504 scores
       only change when a new term's ratings post, and a full campus crawl
       is a multi-hour job (see CLAUDE.md), not something to repeat daily.
   Neither auto-runs on a brand new database with no prior run -- the first
   run of either, especially evaluations' ~40k-request backfill, is a
   deliberate action via the admin ingestion page's buttons, not something
   that should silently kick off the moment the server boots. */
import { db } from "../../scrapers/lib/db.js";
import { scrapeAllSections, scrapeAllEvaluations } from "../../scrapers/run.js";

const CHECK_INTERVAL_MS = 15 * 60 * 1000;
export const SCHEDULE_INTERVAL_HOURS = 24;
export const EVALUATIONS_INTERVAL_DAYS = 120;

const running = { schedule: false, evaluations: false };

export function lastRun(kind) {
  return db.prepare(`SELECT * FROM scrape_runs WHERE kind = ? ORDER BY id DESC LIMIT 1`).get(kind) || null;
}

export function nextAutoRunAt(kind) {
  const last = db
    .prepare(`SELECT started_at FROM scrape_runs WHERE kind = ? AND status = 'done' ORDER BY id DESC LIMIT 1`)
    .get(kind);
  const base = last ? new Date(last.started_at) : new Date();
  const ms =
    kind === "schedule"
      ? SCHEDULE_INTERVAL_HOURS * 3600 * 1000
      : EVALUATIONS_INTERVAL_DAYS * 24 * 3600 * 1000;
  return new Date(base.getTime() + ms);
}

export function isRunning(kind) {
  return running[kind];
}

const updateProgress = db.prepare(
  `UPDATE scrape_runs SET progress_current=?, progress_done=?, progress_total=?, sections_count=?, evaluations_count=? WHERE id=?`
);

/* fn receives an onProgress(done, total, label, count) it can call as
   often as it likes -- scrapeAllSections/scrapeAllEvaluations call it once
   per subject/instructor, which is what makes the ingestion page's numbers
   move during a run instead of sitting at 0 until it finishes. countKind
   says whether `count` from onProgress means sections_count or
   evaluations_count for the live display. */
async function runOne(kind, trigger, fn, formatSummary, countKind) {
  if (running[kind]) throw new Error(`A ${kind} scrape is already running.`);
  running[kind] = true;
  const startedAt = new Date().toISOString();
  const { lastInsertRowid } = db
    .prepare(`INSERT INTO scrape_runs (kind, trigger, status, started_at) VALUES (?, ?, 'running', ?)`)
    .run(kind, trigger, startedAt);

  const onProgress = (done, total, label, count) => {
    updateProgress.run(
      label,
      done,
      total,
      countKind === "sections" ? count : 0,
      countKind === "evaluations" ? count : 0,
      lastInsertRowid
    );
  };

  try {
    const result = await fn(onProgress);
    db.prepare(
      `UPDATE scrape_runs SET status='done', finished_at=?, summary=?, sections_count=?, evaluations_count=?, progress_current=NULL WHERE id=?`
    ).run(
      new Date().toISOString(),
      formatSummary(result),
      result.sectionsCount ?? 0,
      result.newEvaluations ?? 0,
      lastInsertRowid
    );
    return result;
  } catch (err) {
    db.prepare(`UPDATE scrape_runs SET status='error', finished_at=?, summary=?, progress_current=NULL WHERE id=?`).run(
      new Date().toISOString(),
      String(err.message || err),
      lastInsertRowid
    );
    throw err;
  } finally {
    running[kind] = false;
  }
}

export function triggerScheduleRun(trigger) {
  return runOne(
    "schedule",
    trigger,
    (onProgress) => scrapeAllSections(undefined, onProgress),
    (r) => `${r.subjectsScanned} subjects, ${r.sectionsCount} sections`,
    "sections"
  );
}

export function triggerEvaluationsRun(trigger) {
  return runOne(
    "evaluations",
    trigger,
    (onProgress) => scrapeAllEvaluations(onProgress),
    (r) => `${r.instructors} instructors campus-wide, ${r.newEvaluations} new evaluations`,
    "evaluations"
  );
}

/* Only fires while this server process is alive. There's no OS-level cron
   here -- if the process isn't running, neither "daily" nor "once a
   semester" happens. */
export function startAutoScheduler() {
  setInterval(() => {
    if (!running.schedule && new Date() >= nextAutoRunAt("schedule")) {
      triggerScheduleRun("auto").catch((e) => console.error("Auto schedule scrape failed:", e.message));
    }
    if (!running.evaluations && new Date() >= nextAutoRunAt("evaluations")) {
      triggerEvaluationsRun("auto").catch((e) => console.error("Auto evaluations scrape failed:", e.message));
    }
  }, CHECK_INTERVAL_MS);
}

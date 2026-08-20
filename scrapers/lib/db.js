import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/* Local dev: a file next to this project, as before. Hosted (e.g. Render):
   set DB_DIR to the mounted persistent disk's path (Render's own default
   mount point is /var/data) so the database survives restarts/redeploys --
   without a real disk under it, a fresh container has no file at all. */
const DB_PATH = process.env.DB_DIR
  ? join(process.env.DB_DIR, "lode.db")
  : fileURLToPath(new URL("../data/lode.db", import.meta.url));
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

/* WAL instead of the default rollback-journal mode: a writer no longer
   locks the whole file against readers. Matters specifically because the
   scrapers now batch their inserts into per-subject/per-instructor
   transactions (see scrapers/run.js) instead of one implicit transaction
   per row -- without WAL, a batched transaction would block the admin
   panel's own reads (ingestion progress polling, the Data tab) for its
   whole duration instead of just a single row's fsync. */
db.exec("PRAGMA journal_mode = WAL");

/* Every table carries the term it was scraped for and when, so re-running
   for a new term appends a parallel slice instead of overwriting the last
   one. See CLAUDE.md, "semester by semester logs." */
db.exec(`
CREATE TABLE IF NOT EXISTS instructors (
  username    TEXT PRIMARY KEY,
  name        TEXT,
  college     TEXT,
  department  TEXT,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS evaluations (
  username              TEXT NOT NULL,
  course_id             TEXT NOT NULL,
  term_label            TEXT,
  course_code           TEXT,
  course_title          TEXT,
  crn                   TEXT,
  instructor_avg        REAL,
  instructor_n          INTEGER,
  instructor_excellent  REAL,
  instructor_good       REAL,
  instructor_satisfactory REAL,
  instructor_poor       REAL,
  instructor_verypoor   REAL,
  instructor_noresponse REAL,
  course_avg            REAL,
  course_excellent      REAL,
  course_good           REAL,
  course_satisfactory   REAL,
  course_poor           REAL,
  course_verypoor       REAL,
  course_noresponse     REAL,
  scraped_at            TEXT NOT NULL,
  PRIMARY KEY (username, course_id)
);

CREATE TABLE IF NOT EXISTS sections (
  term_code       TEXT NOT NULL,
  term_label      TEXT,
  crn             TEXT NOT NULL,
  subject         TEXT,
  course_number   TEXT,
  section         TEXT,
  title           TEXT,
  instructor_name TEXT,
  days            TEXT,
  start_time      TEXT,
  end_time        TEXT,
  room            TEXT,
  campus          TEXT,
  schedule_type   TEXT,
  credits         REAL,
  reg_start       TEXT,
  reg_end         TEXT,
  scraped_at      TEXT NOT NULL,
  PRIMARY KEY (term_code, crn)
);

/* Anonymous feedback from the "Rate this tool" card on the schedule page.
   Was a localStorage-only stub before the admin/server layer existed; now
   the server is the single copy so an admin can see it from anywhere. */
CREATE TABLE IF NOT EXISTS reviews (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  rating        INTEGER NOT NULL,
  name          TEXT,
  text          TEXT,
  submitted_at  TEXT NOT NULL
);

/* One row per scrape run (automatic or button-triggered), so the ingestion
   page can show history and the scheduler can compute "next run" from the
   last completed one instead of trusting an in-memory timer that resets on
   restart. Schedule and evaluations are two independent scrapers with very
   different cadences (schedule changes during add/drop, so it runs daily;
   HB 2504 evaluations only change once a semester's ratings post), so each
   run row records which one it was. */
CREATE TABLE IF NOT EXISTS scrape_runs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kind          TEXT NOT NULL DEFAULT 'schedule', -- 'schedule' | 'evaluations'
  trigger       TEXT NOT NULL,   -- 'auto' | 'manual'
  status        TEXT NOT NULL,   -- 'running' | 'done' | 'error'
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  summary       TEXT,            -- short human-readable result, or error message
  sections_count      INTEGER DEFAULT 0,
  evaluations_count   INTEGER DEFAULT 0,
  progress_current     TEXT,     -- e.g. "jsmith (312 of 1965 instructors)", updated live
  progress_done        INTEGER DEFAULT 0,
  progress_total       INTEGER DEFAULT 0
);

/* Admin login sessions. One shared admin password (see server/lib/auth.js),
   not per-user accounts -- this is a single-operator tool. */
CREATE TABLE IF NOT EXISTS admin_sessions (
  token       TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);

/* Small key/value store for values that need to persist across restarts but
   don't belong in an env var -- currently just the random salt the admin
   password comparison scrypts against (see server/lib/auth.js), generated
   once on first use instead of a literal string baked into the source. */
CREATE TABLE IF NOT EXISTS app_config (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);

/* "Report a problem" submissions from the footer link -- same idea as
   reviews (public POST, admin-only read), kept in its own table since a
   bug report and a star rating aren't the same shape of data. */
CREATE TABLE IF NOT EXISTS problem_reports (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  page          TEXT,
  email         TEXT,
  text          TEXT NOT NULL,
  submitted_at  TEXT NOT NULL
);

/* Rate My Professors. Unlike every other table in this file, this one is
   sourced from a site whose own Terms of Service explicitly prohibit
   automated access -- see CLAUDE.md, Data sources, and scrapers/rmp.js's
   header comment for the full reasoning. Two tables, matching the two
   scrape steps: the full campus professor list (aggregate numbers only,
   cheap, ~2,400 rows) and a *bounded* review sample (only for instructors
   who also match someone actually teaching a real UTEP course right now
   -- see scrapers/run.js -- and only the handful of reviews RMP's own
   professor page embeds server-side, never a deeper pull). */
CREATE TABLE IF NOT EXISTS rmp_professors (
  legacy_id             INTEGER PRIMARY KEY,
  first_name            TEXT,
  last_name             TEXT,
  department            TEXT,
  avg_rating            REAL,
  num_ratings           INTEGER,
  would_take_again_pct  REAL,
  avg_difficulty        REAL,
  dist_r1               INTEGER,  -- quality-rating counts, 1 (awful) to 5 (awesome) --
  dist_r2               INTEGER,  -- same bucket count RMP's own page graphs, not derived --
  dist_r3               INTEGER,  -- from avg_rating. NULL (not 0) when a professor has no --
  dist_r4               INTEGER,  -- ratingsDistribution node in the Relay store at all.  --
  dist_r5               INTEGER,
  scraped_at            TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rmp_reviews (
  legacy_id         INTEGER NOT NULL,
  review_id         INTEGER NOT NULL,
  course_code       TEXT,
  rating_date       TEXT,
  quality           REAL,
  difficulty        REAL,
  would_take_again  INTEGER,  -- 1 yes, 0 no, -1 not answered
  grade             TEXT,
  tags              TEXT,     -- JSON array, e.g. ["Amazing lectures","Respected"]
  comment           TEXT,
  scraped_at        TEXT NOT NULL,
  PRIMARY KEY (legacy_id, review_id)
);
`);

/* Migrations for scrape_runs columns added after the table already existed
   on disk -- CREATE TABLE IF NOT EXISTS doesn't touch an existing table. */
function ensureColumn(table, column, ddl) {
  const exists = db
    .prepare(`SELECT 1 FROM pragma_table_info(?) WHERE name = ?`)
    .get(table, column);
  if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}
ensureColumn("scrape_runs", "kind", `kind TEXT NOT NULL DEFAULT 'schedule'`);
ensureColumn("scrape_runs", "progress_current", `progress_current TEXT`);
ensureColumn("scrape_runs", "progress_done", `progress_done INTEGER DEFAULT 0`);
ensureColumn("scrape_runs", "progress_total", `progress_total INTEGER DEFAULT 0`);
ensureColumn("scrape_runs", "rmp_count", `rmp_count INTEGER DEFAULT 0`);
ensureColumn("rmp_professors", "dist_r1", `dist_r1 INTEGER`);
ensureColumn("rmp_professors", "dist_r2", `dist_r2 INTEGER`);
ensureColumn("rmp_professors", "dist_r3", `dist_r3 INTEGER`);
ensureColumn("rmp_professors", "dist_r4", `dist_r4 INTEGER`);
ensureColumn("rmp_professors", "dist_r5", `dist_r5 INTEGER`);

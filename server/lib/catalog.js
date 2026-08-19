/* Turns the raw scraped tables (sections, instructors, evaluations) into
   the same per-course, per-instructor shape the prototype used to get from
   prototype/js/data.js's fabricated CATALOG -- real data standing in for
   fake data, not a new UI. See CLAUDE.md, Build order phase 3.

   The one genuinely hard problem here: sections.instructor_name comes from
   Banner as "First Last (P)" (schedule.js keeps the "(P)" primary-instructor
   marker on purpose, see its own regression test), but instructors.name
   comes from HB 2504 as "Last, First[ Middle initial]" -- a different
   source, a different name order, often an extra middle initial Banner
   doesn't carry, and no shared ID between them. There's no canonical join
   key, so this matches on name *words*: Banner's "Vladik Kreinovich"
   ({vladik,kreinovich}) has to match HB 2504's "Kreinovich, Vladik Y."
   ({kreinovich,vladik,y}) even though the second set has an extra token --
   confirmed a real, common case (that exact instructor), not a hypothetical
   -- so this matches when either side's word set is fully contained in the
   other's, not only on exact equality. Instructors that still don't match
   -- a genuine mismatch, a name recorded differently in each source,
   someone not in the HB 2504 directory at all -- fall back to the same "no
   data" state the UI already has to handle for a brand new hire, rather
   than a new failure mode. Display name always comes from Banner (natural
   "First Last" order); the HB 2504 side is only ever used to find the
   evaluation data, never shown -- its "Last, First" order reads as an
   admin record, not something to put in front of a student. */
import { db } from "../../scrapers/lib/db.js";

const PRIOR_MEAN = 4.2;
const PRIOR_C = 12;

function nameTokenSet(raw) {
  return new Set(
    (raw || "")
      .replace(/\([^)]*\)/g, " ")
      .replace(/[^a-zA-Z\s'-]/g, " ")
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
  );
}

function isSubset(smaller, larger) {
  for (const t of smaller) if (!larger.has(t)) return false;
  return true;
}

function cleanBannerName(raw) {
  return (raw || "").replace(/\s*\([^)]*\)\s*$/, "").trim();
}

// Rebuilt per call rather than cached -- the instructors table only changes
// on a scrape (every ~120 days) and is a couple thousand rows, cheap enough
// that a stale cache surviving a live rescrape isn't worth the risk.
function instructorIndex() {
  return db
    .prepare(`SELECT * FROM instructors`)
    .all()
    .map((row) => ({ tokens: nameTokenSet(row.name), row }));
}

// Prefers an exact word-set match when one exists, so a subset match
// elsewhere in a ~2,000-person directory can't outrank the real one.
function findInstructor(index, bannerName) {
  const bannerTokens = nameTokenSet(bannerName);
  if (!bannerTokens.size) return null;
  let subsetMatch = null;
  for (const { tokens, row } of index) {
    if (tokens.size === bannerTokens.size && isSubset(bannerTokens, tokens)) return row;
    if (!subsetMatch && (isSubset(bannerTokens, tokens) || isSubset(tokens, bannerTokens))) subsetMatch = row;
  }
  return subsetMatch;
}

const evalsForUsername = db.prepare(`SELECT * FROM evaluations WHERE username = ?`);

// Recent terms count more than old ones (CLAUDE.md's scoring rules say so
// explicitly) -- a simple linear decay by year parsed out of the term
// label, floored rather than zeroed so a stale-but-real rating still
// counts for something instead of vanishing from the average outright.
function recencyWeight(termLabel) {
  const m = /\d{4}/.exec(termLabel || "");
  if (!m) return 0.6;
  const age = Math.max(0, new Date().getFullYear() - Number(m[0]));
  return Math.max(0.35, 1 - age * 0.15);
}

/* Blends every evaluation on file for one instructor -- across every
   course and term they've taught, not just the course being looked up --
   into one instructor-level rating. That's deliberate: CLAUDE.md's rule is
   "rank on the instructor rating, not the course rating," specifically so
   a required weeder course doesn't tank a good professor's score. Returns
   null when there's nothing to aggregate, which the UI already renders as
   "no data," not a bad score. */
export function aggregateInstructor(evaluations) {
  let weightedSum = 0;
  let weight = 0;
  let totalN = 0;
  const buckets = { excellent: 0, good: 0, satisfactory: 0, poor: 0, verypoor: 0 };
  let bucketWeight = 0;

  for (const e of evaluations) {
    if (e.instructor_avg == null || e.instructor_n == null) continue;
    const w = e.instructor_n * recencyWeight(e.term_label);
    weightedSum += e.instructor_avg * w;
    weight += w;
    totalN += e.instructor_n;
    if (e.instructor_excellent != null) {
      buckets.excellent += e.instructor_excellent * w;
      buckets.good += (e.instructor_good ?? 0) * w;
      buckets.satisfactory += (e.instructor_satisfactory ?? 0) * w;
      buckets.poor += (e.instructor_poor ?? 0) * w;
      buckets.verypoor += (e.instructor_verypoor ?? 0) * w;
      bucketWeight += w;
    }
  }
  if (weight === 0) return null;

  const raw = weightedSum / weight;
  const adj = (PRIOR_C * PRIOR_MEAN + totalN * raw) / (PRIOR_C + totalN);
  const dist = bucketWeight > 0
    ? [buckets.excellent, buckets.good, buckets.satisfactory, buckets.poor, buckets.verypoor].map((v) => v / bucketWeight)
    : null;
  return { raw, n: totalN, adj, dist };
}

export function latestTerm() {
  return db.prepare(`SELECT term_code, term_label FROM sections ORDER BY term_code DESC LIMIT 1`).get() || null;
}

export function listCourses(termCode) {
  return db
    .prepare(
      `SELECT subject, course_number, MIN(title) AS title FROM sections
       WHERE term_code = ? GROUP BY subject, course_number ORDER BY subject, course_number`
    )
    .all(termCode)
    .map((r) => ({ code: `${r.subject} ${r.course_number}`, title: r.title }));
}

/* One course's real sections, grouped by matched (or best-effort
   unmatched) instructor, each with an aggregated rating. No RMP field is
   ever populated -- Rate My Professors was never scraped (see CLAUDE.md,
   Data sources: "RMP school ID still not looked up") -- and every section
   omits seats/capacity, since that data doesn't exist in any public UTEP
   source at all, not just one this project hasn't gotten to yet. */
export function getCourse(termCode, subject, courseNumber) {
  const sections = db
    .prepare(`SELECT * FROM sections WHERE term_code = ? AND subject = ? AND course_number = ? ORDER BY section ASC`)
    .all(termCode, subject, courseNumber);
  if (!sections.length) return null;

  const idx = instructorIndex();
  const groups = new Map(); // cleaned Banner name -> { name, dept, username, sections }
  for (const s of sections) {
    const cleaned = cleanBannerName(s.instructor_name);
    const key = cleaned || "__staff__";
    if (!groups.has(key)) {
      const matched = cleaned ? findInstructor(idx, cleaned) : null;
      groups.set(key, {
        name: cleaned || "Staff",
        dept: matched ? matched.department : null,
        username: matched ? matched.username : null,
        sections: [],
      });
    }
    groups.get(key).sections.push({
      crn: s.crn,
      days: s.days ? s.days.split("") : [],
      start: s.start_time,
      end: s.end_time,
      room: s.room,
      campus: s.campus,
      scheduleType: s.schedule_type,
      credits: s.credits,
      regStart: s.reg_start,
      regEnd: s.reg_end,
    });
  }

  const professors = [...groups.values()].map((g) => {
    const agg = g.username ? aggregateInstructor(evalsForUsername.all(g.username)) : null;
    return {
      name: g.name,
      dept: g.dept,
      evalRaw: agg?.raw ?? null,
      evalN: agg?.n ?? 0,
      evalAdj: agg?.adj ?? null,
      dist: agg?.dist ?? null,
      rmp: null,
      sections: g.sections,
    };
  });

  return { title: sections[0].title, professors };
}

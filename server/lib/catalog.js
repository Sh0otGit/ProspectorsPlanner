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
import { nameTokenSet, cleanBannerName, findByName } from "./name-match.js";

const PRIOR_MEAN = 4.2;
const PRIOR_C = 12;

// Rebuilt per call rather than cached -- the instructors table only changes
// on a scrape (every ~120 days) and is a couple thousand rows, cheap enough
// that a stale cache surviving a live rescrape isn't worth the risk.
function instructorIndex() {
  return db
    .prepare(`SELECT * FROM instructors`)
    .all()
    .map((row) => ({ tokens: nameTokenSet(row.name), row }));
}

function rmpIndex() {
  return db
    .prepare(`SELECT * FROM rmp_professors`)
    .all()
    .map((row) => ({ tokens: nameTokenSet(`${row.first_name} ${row.last_name}`), row }));
}

const evalsForUsername = db.prepare(`SELECT * FROM evaluations WHERE username = ?`);
const rmpReviewsForLegacyId = db.prepare(`SELECT * FROM rmp_reviews WHERE legacy_id = ? ORDER BY rating_date DESC`);

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

/* Some sections are a required companion to another course rather than a
   real standalone choice -- a lab in its own course number (PHYS 2120,
   "Laboratory for PHYS 2320") or a same-numbered seminar/recitation
   alongside a lecture (PHYS 2320-009, Seminar). UTEP's own registration
   system (Banner 9 Self-Service, CAS-gated) resolves the exact CRN
   pairing via a "Linked Sections" list we have no access to -- confirmed
   2026-08-20, that data doesn't exist anywhere public. What's derivable
   from data already scraped: lab sections almost always spell their
   parent course out in their own title ("Laboratory for X ####" /
   "Lab for X ####"), always within the lab's own subject (confirmed
   against every such title on file, no exceptions) -- no new scraping
   needed, just a regex over sections.title. A same-course-number
   seminar/recitation needs no lookup at all: getCourse() already groups
   every schedule_type for a course number together, so the seminar
   sections are already sitting right there in the same response. */
const LAB_TITLE_RE = /\bfor\s+.*?(\d{3,4})\s*$/i;

// Rebuilt per call, same tradeoff as instructorIndex()/rmpIndex() above --
// this scans every distinct (subject, course_number, title), a few
// thousand rows, cheap next to a scrape's own cadence.
function labParentIndex() {
  const rows = db.prepare(`SELECT DISTINCT subject, course_number, title FROM sections WHERE title IS NOT NULL`).all();
  const index = new Map(); // "SUBJECT NUMBER" (the parent/lecture course) -> {subject, courseNumber}
  for (const r of rows) {
    const m = LAB_TITLE_RE.exec(r.title || "");
    if (!m) continue;
    index.set(`${r.subject} ${m[1]}`, { subject: r.subject, courseNumber: r.course_number });
  }
  return index;
}

function courseTitle(termCode, subject, courseNumber) {
  const row = db
    .prepare(`SELECT MIN(title) AS title FROM sections WHERE term_code = ? AND subject = ? AND course_number = ?`)
    .get(termCode, subject, courseNumber);
  return row?.title ?? null;
}

/* One course's real sections, grouped by matched (or best-effort
   unmatched) instructor, each with an aggregated HB 2504 rating and,
   where a Banner name matches an rmp_professors row (same word-set
   matching as the HB 2504 side, see name-match.js), a real RMP aggregate
   and every review RMP has on file for them (scrapers/rmp.js pages
   through the full ratings connection, not just the handful the
   professor page itself embeds). Unmatched on either side is "no data,"
   the same state already shown for a brand new hire, not an error. Every
   section omits seats/capacity, since that data doesn't exist in any
   public UTEP source at all, not just one this project hasn't gotten to
   yet. */
// "Apr 2026", matching the granularity the old fabricated reviews used --
// RMP's own timestamp is a full "2026-08-17 16:31:40 +0000 UTC" string,
// more precision than a review date needs here.
function formatReviewDate(raw) {
  const d = raw ? new Date(raw.replace(" +0000 UTC", "Z").replace(" ", "T")) : null;
  if (!d || isNaN(d)) return raw || "";
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

export function getCourse(termCode, subject, courseNumber) {
  const sections = db
    .prepare(`SELECT * FROM sections WHERE term_code = ? AND subject = ? AND course_number = ? ORDER BY section ASC`)
    .all(termCode, subject, courseNumber);
  if (!sections.length) return null;

  const labMatch = labParentIndex().get(`${subject} ${courseNumber}`) || null;
  const requiresLab = labMatch
    ? { subject: labMatch.subject, courseNumber: labMatch.courseNumber, title: courseTitle(termCode, labMatch.subject, labMatch.courseNumber) }
    : null;
  // Every distinct schedule_type under this one course number -- a plain
  // Lecture-only course has exactly one and needs no disclaimer. More
  // than one means a student can genuinely add more than one section at
  // once for this course (a lecture *and* its seminar), which
  // getChosenSection-era app.js used to structurally forbid.
  const components = [...new Set(sections.map((s) => s.schedule_type))];

  const idx = instructorIndex();
  const rmpIdx = rmpIndex();
  const groups = new Map(); // cleaned Banner name -> { name, dept, username, rmpRow, sections }
  for (const s of sections) {
    const cleaned = cleanBannerName(s.instructor_name);
    const key = cleaned || "__staff__";
    if (!groups.has(key)) {
      const matched = cleaned ? findByName(idx, cleaned) : null;
      const rmpMatched = cleaned ? findByName(rmpIdx, cleaned) : null;
      groups.set(key, {
        name: cleaned || "Staff",
        dept: matched ? matched.department : null,
        username: matched ? matched.username : null,
        rmpRow: rmpMatched,
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
    // A matched rmp_professors row with no real average (possible for
    // someone RMP has on file with zero ratings) has to be treated as
    // unmatched, not a score of 0 -- combined() in app.js blends
    // p.rmp.score straight in whenever p.rmp is truthy, so treating "no
    // ratings yet" as a real 0 score would silently drag a good UTEP
    // evaluation average down toward half its value. RMP's own API
    // returns a literal 0 (not null) for avg_rating when num_ratings is
    // 0 -- confirmed against real data, not a hypothetical -- so the
    // guard has to check num_ratings, not just null-ness of avg_rating.
    // Distribution counts only exist for the bounded set of currently-
    // teaching matched instructors (a detail-page fetch, not the full
    // campus list -- see scrapers/rmp.js), so a real rmp match can still
    // have dist_r1 null even with a real score. Same [Excellent..Very
    // Poor] percentage-array shape as the UTEP `dist` above (r5 down to
    // r1) so either can drive the same bar-rendering code.
    const rmpDistTotal = g.rmpRow
      ? (g.rmpRow.dist_r1 ?? 0) + (g.rmpRow.dist_r2 ?? 0) + (g.rmpRow.dist_r3 ?? 0) + (g.rmpRow.dist_r4 ?? 0) + (g.rmpRow.dist_r5 ?? 0)
      : 0;
    const rmpDist = g.rmpRow && g.rmpRow.dist_r1 != null && rmpDistTotal > 0
      ? [g.rmpRow.dist_r5, g.rmpRow.dist_r4, g.rmpRow.dist_r3, g.rmpRow.dist_r2, g.rmpRow.dist_r1].map((n) => (n / rmpDistTotal) * 100)
      : null;
    const rmp = g.rmpRow && g.rmpRow.avg_rating != null && g.rmpRow.num_ratings > 0
      ? {
          score: g.rmpRow.avg_rating,
          diff: g.rmpRow.avg_difficulty,
          wta: g.rmpRow.would_take_again_pct,
          n: g.rmpRow.num_ratings,
          legacyId: g.rmpRow.legacy_id,
          dist: rmpDist,
        }
      : null;
    const reviews = g.rmpRow
      ? rmpReviewsForLegacyId.all(g.rmpRow.legacy_id).map((r) => ({
          course: r.course_code || "",
          date: formatReviewDate(r.rating_date),
          q: r.quality,
          d: r.difficulty,
          wta: r.would_take_again === 1 ? true : r.would_take_again === 0 ? false : null,
          grade: r.grade || "",
          tags: r.tags ? JSON.parse(r.tags) : [],
          text: r.comment || "",
        }))
      : [];
    return {
      name: g.name,
      dept: g.dept,
      evalRaw: agg?.raw ?? null,
      evalN: agg?.n ?? 0,
      evalAdj: agg?.adj ?? null,
      dist: agg?.dist ?? null,
      rmp,
      reviews,
      sections: g.sections,
    };
  });

  return { title: sections[0].title, professors, requiresLab, components };
}

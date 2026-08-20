/* Two independent scrapers, deliberately not run together:
     - Schedule: every section, every subject, for one term. Meant to run
       daily -- rooms/times/instructors can change during add/drop.
     - Evaluations: every instructor's HB 2504 history, campus-wide. Meant
       to run once a semester -- eval scores only change when a new term's
       ratings get published, and a full crawl is ~40k requests (see
       CLAUDE.md), not something to repeat daily.
   Both are callable standalone (`node scrapers/run.js schedule` or
   `node scrapers/run.js evaluations`) and from server/lib/scheduler.js. */
import { pathToFileURL } from "node:url";
import { db } from "./lib/db.js";
import { fetchDirectory, filterByDepartment } from "./faculty_directory.js";
import { fetchProfileEvaluationLinks } from "./profiles.js";
import { fetchEvaluation } from "./evaluations.js";
import { fetchSchedule, fetchSubjects } from "./schedule.js";
import { fetchAllProfessors, fetchProfessorDetail } from "./rmp.js";
import { nameTokenSet, cleanBannerName, findByName } from "../server/lib/name-match.js";

export const DEFAULT_TERM = "202710"; // Fall 2026
export const DEFAULT_DEPARTMENT = "Computer Science"; // still available for a scoped run
export const DEFAULT_SUBJECT = "CS";

/* =====================================================================
   SCHEDULE -- daily
   ===================================================================== */
const upsertSection = db.prepare(`
  INSERT INTO sections (term_code, term_label, crn, subject, course_number, section, title,
    instructor_name, days, start_time, end_time, room, campus, schedule_type, credits,
    reg_start, reg_end, scraped_at)
  VALUES (@termCode, @termLabel, @crn, @subject, @courseNumber, @section, @title,
    @instructorName, @days, @startTime, @endTime, @room, @campus, @scheduleType, @credits,
    @regStart, @regEnd, @scrapedAt)
  ON CONFLICT(term_code, crn) DO UPDATE SET
    title=excluded.title, instructor_name=excluded.instructor_name, days=excluded.days,
    start_time=excluded.start_time, end_time=excluded.end_time, room=excluded.room,
    campus=excluded.campus, schedule_type=excluded.schedule_type, credits=excluded.credits,
    reg_start=excluded.reg_start, reg_end=excluded.reg_end, scraped_at=excluded.scraped_at
`);

/* One subject at a time -- "%" (every subject) confirmed to hang, see
   CLAUDE.md. Used both for a single-subject scrape and as the inner loop
   of scrapeAllSections. */
export async function scrapeSchedule(term = DEFAULT_TERM, subject = DEFAULT_SUBJECT) {
  const sections = await fetchSchedule(term, subject, "");
  const scrapedAt = new Date().toISOString();
  // One transaction per subject instead of one per section: SQLite fsyncs
  // once per uncommitted transaction, so 7,196 individual inserts meant
  // 7,196 fsyncs. Measured locally: ~12.9s for that many one-row
  // transactions vs. ~6ms wrapped in one -- a difference this loop was
  // paying on every single scrape run. Scoped to one subject (not the
  // whole scrape) so the write lock a transaction holds stays brief; see
  // db.js for the WAL mode change that keeps this from blocking reads too.
  db.exec("BEGIN");
  try {
    for (const s of sections) upsertSection.run({ ...s, scrapedAt });
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return sections.length;
}

/* Every subject offered in `term`, one request each (~150, a few minutes
   total at the rate limit). This is the daily job. onProgress(done, total,
   label) fires after each subject, so a caller (the admin ingestion page)
   can show live progress on something that isn't instant. */
export async function scrapeAllSections(term = DEFAULT_TERM, onProgress) {
  const subjects = await fetchSubjects(term);
  let total = 0;
  for (let i = 0; i < subjects.length; i++) {
    total += await scrapeSchedule(term, subjects[i]);
    onProgress?.(i + 1, subjects.length, subjects[i], total);
  }
  return { subjectsScanned: subjects.length, sectionsCount: total };
}

/* =====================================================================
   EVALUATIONS -- once a semester
   ===================================================================== */
const upsertInstructor = db.prepare(`
  INSERT INTO instructors (username, name, college, department, updated_at)
  VALUES (@username, @name, @college, @department, @updatedAt)
  ON CONFLICT(username) DO UPDATE SET
    name=excluded.name, college=excluded.college, department=excluded.department, updated_at=excluded.updated_at
`);
const insertEval = db.prepare(`
  INSERT INTO evaluations (username, course_id, term_label, course_code, course_title, crn,
    instructor_avg, instructor_n, instructor_excellent, instructor_good, instructor_satisfactory,
    instructor_poor, instructor_verypoor, instructor_noresponse,
    course_avg, course_excellent, course_good, course_satisfactory, course_poor, course_verypoor,
    course_noresponse, scraped_at)
  VALUES (@username, @courseId, @termLabel, @courseCode, @courseTitle, @crn,
    @instructorAvg, @instructorN, @instructorExcellent, @instructorGood, @instructorSatisfactory,
    @instructorPoor, @instructorVeryPoor, @instructorNoResponse,
    @courseAvg, @courseExcellent, @courseGood, @courseSatisfactory, @coursePoor, @courseVeryPoor,
    @courseNoResponse, @scrapedAt)
`);
const evalExists = db.prepare(`SELECT 1 FROM evaluations WHERE username = ? AND course_id = ?`);

async function scrapeInstructorList(targets, onProgress) {
  const now = new Date().toISOString();
  let newEvals = 0;
  for (let i = 0; i < targets.length; i++) {
    const instr = targets[i];
    const links = await fetchProfileEvaluationLinks(instr.username);
    const newLinks = links.filter((link) => !evalExists.get(link.username, link.courseId));
    // Fetch every new evaluation *before* opening a transaction -- each
    // fetch is a rate-limited network request (~700ms, see fetch.js), and
    // a transaction sitting open across awaits like that would hold its
    // write lock for the length of the slowest part of the whole loop
    // instead of the length of the actual writes.
    const fetched = [];
    for (const link of newLinks) fetched.push({ link, ev: await fetchEvaluation(link.username, link.courseId) });

    // Now the fast part: this instructor's upsert plus every evaluation
    // just fetched for them, committed together instead of as N+1
    // separate transactions. Same reasoning as scrapeSchedule's batching
    // above -- brief, per-instructor, not one transaction for the whole
    // multi-hour backfill.
    db.exec("BEGIN");
    try {
      // node:sqlite rejects named params that don't appear in the query,
      // so this can't be a plain spread -- `instr` also carries `rank`,
      // which isn't stored (not used anywhere yet).
      upsertInstructor.run({
        username: instr.username,
        name: instr.name,
        college: instr.college,
        department: instr.department,
        updatedAt: now,
      });
      for (const { link, ev } of fetched) {
        insertEval.run({
          username: link.username,
          courseId: link.courseId,
          termLabel: link.termLabel,
          courseCode: link.courseCode,
          courseTitle: link.courseTitle,
          crn: link.crn,
          instructorAvg: ev.instructor?.avg ?? null,
          instructorN: ev.responseCount ?? null,
          instructorExcellent: ev.instructor?.excellent ?? null,
          instructorGood: ev.instructor?.good ?? null,
          instructorSatisfactory: ev.instructor?.satisfactory ?? null,
          instructorPoor: ev.instructor?.poor ?? null,
          instructorVeryPoor: ev.instructor?.veryPoor ?? null,
          instructorNoResponse: ev.instructor?.noResponse ?? null,
          courseAvg: ev.course?.avg ?? null,
          courseExcellent: ev.course?.excellent ?? null,
          courseGood: ev.course?.good ?? null,
          courseSatisfactory: ev.course?.satisfactory ?? null,
          coursePoor: ev.course?.poor ?? null,
          courseVeryPoor: ev.course?.veryPoor ?? null,
          courseNoResponse: ev.course?.noResponse ?? null,
          scrapedAt: now,
        });
        newEvals++;
      }
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    onProgress?.(i + 1, targets.length, instr.username, newEvals);
  }
  return newEvals;
}

/* One department (substring match on the HB 2504 directory's department
   text). Useful for a quick, cheap re-check of one area without paying for
   the full campus crawl. */
export async function scrapeEvaluations(departmentNeedle = DEFAULT_DEPARTMENT, onProgress) {
  const directory = await fetchDirectory();
  const targets = filterByDepartment(directory, departmentNeedle);
  const newEvaluations = await scrapeInstructorList(targets, onProgress);
  return { instructors: targets.length, newEvaluations };
}

/* Every instructor in the HB 2504 directory, campus-wide (~1965 people).
   Only new course_ids are actually fetched -- see "cache aggressively,
   backfill once" in CLAUDE.md -- so a repeat run is much cheaper than the
   first one, but the first one is still a ~40k-request, several-hour job.
   This is the once-a-semester job. */
export async function scrapeAllEvaluations(onProgress) {
  const directory = await fetchDirectory();
  const newEvaluations = await scrapeInstructorList(directory, onProgress);
  return { instructors: directory.length, newEvaluations };
}

/* =====================================================================
   RATE MY PROFESSORS -- see rmp.js's header for why this exists despite
   RMP's ToS, and CLAUDE.md's Data sources entry for the same. Two steps:
   the full campus professor list (aggregate numbers, cheap), then a
   review pull for every review of every professor who matches someone
   actually teaching a real UTEP section this term, not the full ~2,400.
   The bound is on *which professors* get a detail fetch at all, not on
   how many of their reviews come back once they qualify -- scraping
   detail pages for professors nobody's actively comparing on this site
   would be exactly the unbounded pull CLAUDE.md's plan says not to do.
   ===================================================================== */
const upsertRmpProfessor = db.prepare(`
  INSERT INTO rmp_professors (legacy_id, first_name, last_name, department,
    avg_rating, num_ratings, would_take_again_pct, avg_difficulty,
    dist_r1, dist_r2, dist_r3, dist_r4, dist_r5, scraped_at)
  VALUES (@legacyId, @firstName, @lastName, @department,
    @avgRating, @numRatings, @wouldTakeAgainPercent, @avgDifficulty,
    @distR1, @distR2, @distR3, @distR4, @distR5, @scrapedAt)
  ON CONFLICT(legacy_id) DO UPDATE SET
    first_name=excluded.first_name, last_name=excluded.last_name, department=excluded.department,
    avg_rating=excluded.avg_rating, num_ratings=excluded.num_ratings,
    would_take_again_pct=excluded.would_take_again_pct, avg_difficulty=excluded.avg_difficulty,
    -- The full-campus list pass (scrapeAllRmpProfessors) never has a
    -- distribution to offer -- only the bounded detail-page pass
    -- (scrapeRmpReviews) does. COALESCE keeps whatever a prior detail
    -- fetch already stored instead of the list pass wiping it back to
    -- null on its next run.
    dist_r1=COALESCE(excluded.dist_r1, rmp_professors.dist_r1),
    dist_r2=COALESCE(excluded.dist_r2, rmp_professors.dist_r2),
    dist_r3=COALESCE(excluded.dist_r3, rmp_professors.dist_r3),
    dist_r4=COALESCE(excluded.dist_r4, rmp_professors.dist_r4),
    dist_r5=COALESCE(excluded.dist_r5, rmp_professors.dist_r5),
    scraped_at=excluded.scraped_at
`);
const upsertRmpReview = db.prepare(`
  INSERT INTO rmp_reviews (legacy_id, review_id, course_code, rating_date, quality, difficulty,
    would_take_again, grade, tags, comment, scraped_at)
  VALUES (@legacyId, @reviewId, @courseCode, @ratingDate, @quality, @difficulty,
    @wouldTakeAgain, @grade, @tags, @comment, @scrapedAt)
  ON CONFLICT(legacy_id, review_id) DO UPDATE SET
    course_code=excluded.course_code, rating_date=excluded.rating_date, quality=excluded.quality,
    difficulty=excluded.difficulty, would_take_again=excluded.would_take_again, grade=excluded.grade,
    tags=excluded.tags, comment=excluded.comment, scraped_at=excluded.scraped_at
`);
const deleteRmpReviewsFor = db.prepare(`DELETE FROM rmp_reviews WHERE legacy_id = ?`);

/* Every UTEP professor RMP has on file, aggregate numbers only. Batched
   into one transaction (same reasoning as the schedule/evaluations
   scrapers -- see CLAUDE.md's Performance note) since this is ~2,400
   single-row upserts that would otherwise each be their own fsync. */
export async function scrapeAllRmpProfessors(onProgress) {
  const professors = await fetchAllProfessors((done, total) => onProgress?.(done, total, "professor list", 0));
  const scrapedAt = new Date().toISOString();
  db.exec("BEGIN");
  try {
    for (const p of professors) {
      upsertRmpProfessor.run({
        legacyId: p.legacyId,
        firstName: (p.firstName || "").trim(),
        lastName: (p.lastName || "").trim(),
        department: p.department || null,
        avgRating: p.avgRating ?? null,
        numRatings: p.numRatings ?? null,
        wouldTakeAgainPercent: p.wouldTakeAgainPercent ?? null,
        avgDifficulty: p.avgDifficulty ?? null,
        // The search/list query never carries a distribution -- only a
        // detail-page fetch does (see scrapeRmpReviews below). Left null
        // here so the COALESCE in the upsert keeps whatever a prior
        // detail fetch already stored, rather than wiping it out.
        distR1: null, distR2: null, distR3: null, distR4: null, distR5: null,
        scrapedAt,
      });
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return professors.length;
}

/* Distinct Banner instructor names currently teaching a real section,
   matched against the rmp_professors list just scraped -- this is the
   bound. A professor RMP has on file but who isn't teaching anything
   real right now never gets a detail page fetched, so this project's
   review-text footprint tracks "instructors students might actually be
   comparing," not "everyone RMP has ever heard of at UTEP." */
function currentlyTeachingRmpMatches() {
  const names = db
    .prepare(`SELECT DISTINCT instructor_name FROM sections WHERE instructor_name IS NOT NULL`)
    .all()
    .map((r) => cleanBannerName(r.instructor_name))
    .filter(Boolean);
  const rmpIndex = db
    .prepare(`SELECT * FROM rmp_professors`)
    .all()
    .map((row) => ({ tokens: nameTokenSet(`${row.first_name} ${row.last_name}`), row }));
  const matches = new Map(); // legacy_id -> row, de-duplicated
  for (const name of names) {
    const match = findByName(rmpIndex, name);
    if (match) matches.set(match.legacy_id, match);
  }
  return [...matches.values()];
}

/* The bounded part: one detail-page fetch plus a full review pull (see
   fetchAllRatings in rmp.js) per currently-teaching matched professor, not
   every professor RMP has on file. Replaces that professor's whole review
   set each time rather than accumulating forever, since RMP doesn't
   expose a stable "since last scrape" cursor for reviews the way HB
   2504's evaluations do. */
export async function scrapeRmpReviews(onProgress) {
  const targets = currentlyTeachingRmpMatches();
  let reviewCount = 0;
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const detail = await fetchProfessorDetail(t.legacy_id);
    const scrapedAt = new Date().toISOString();
    db.exec("BEGIN");
    try {
      upsertRmpProfessor.run({
        legacyId: detail.legacyId,
        firstName: detail.firstName || "",
        lastName: detail.lastName || "",
        department: detail.department,
        avgRating: detail.avgRating,
        numRatings: detail.numRatings,
        wouldTakeAgainPercent: detail.wouldTakeAgainPercent,
        avgDifficulty: detail.avgDifficulty,
        distR1: detail.ratingsDistribution?.r1 ?? null,
        distR2: detail.ratingsDistribution?.r2 ?? null,
        distR3: detail.ratingsDistribution?.r3 ?? null,
        distR4: detail.ratingsDistribution?.r4 ?? null,
        distR5: detail.ratingsDistribution?.r5 ?? null,
        scrapedAt,
      });
      deleteRmpReviewsFor.run(detail.legacyId);
      for (const r of detail.reviews) {
        upsertRmpReview.run({
          legacyId: detail.legacyId,
          reviewId: r.reviewId,
          courseCode: r.courseCode,
          ratingDate: r.date,
          quality: r.quality,
          difficulty: r.difficulty,
          wouldTakeAgain: r.wouldTakeAgain,
          grade: r.grade,
          tags: JSON.stringify(r.tags),
          comment: r.comment,
          scrapedAt,
        });
        reviewCount++;
      }
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    onProgress?.(i + 1, targets.length, `${detail.firstName} ${detail.lastName}`.trim(), reviewCount);
  }
  return { instructorsMatched: targets.length, reviewCount };
}

/* The whole RMP scrape: campus list, then bounded reviews for whoever's
   actually teaching right now. One admin button, two steps. */
export async function scrapeRmp(onProgress) {
  const professorCount = await scrapeAllRmpProfessors(onProgress);
  const { instructorsMatched, reviewCount } = await scrapeRmpReviews(onProgress);
  return { professorCount, instructorsMatched, reviewCount };
}

/* =====================================================================
   CLI: node scrapers/run.js [schedule|evaluations|rmp] [--all]

   "Is this file the one Node was actually invoked on, or just imported
   by something else" (server/lib/scheduler.js imports this same file and
   must NOT trigger the CLI block on server boot) can't be a plain
   `import.meta.url === \`file://${process.argv[1]}\`` string-build --
   process.argv[1] is a plain filesystem path ("C:\dev\lode\scrapers\run.js"
   on Windows, backslashes and no leading "file://"), import.meta.url is a
   real URL ("file:///C:/dev/lode/scrapers/run.js", forward slashes, three
   slashes after the scheme). Those never match by string equality on
   Windows -- confirmed the hard way: every `node scrapers/run.js <mode>`
   invocation this project ever ran from a Windows shell silently did
   nothing, the whole CLI block just never executed. pathToFileURL() is
   what actually normalizes a filesystem path into the same URL form
   import.meta.url already is, on any platform. */
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , mode] = process.argv;
  if (mode === "evaluations") {
    scrapeAllEvaluations((done, total, label, newEvals) =>
      process.stdout.write(`\r${done}/${total} instructors (${label}), ${newEvals} new evaluations   `)
    )
      .then((r) => console.log(`\n${r.instructors} instructors scanned campus-wide, ${r.newEvaluations} new evaluations`))
      .catch((e) => { console.error("\nEvaluations scrape failed:", e.message); process.exit(1); });
  } else if (mode === "rmp") {
    scrapeRmp((done, total, label) => process.stdout.write(`\r${done}/${total} (${label})   `))
      .then((r) => console.log(`\n${r.professorCount} RMP professors listed, ${r.instructorsMatched} matched to real sections, ${r.reviewCount} reviews stored`))
      .catch((e) => { console.error("\nRMP scrape failed:", e.message); process.exit(1); });
  } else if (mode === "schedule" || mode === undefined) {
    scrapeAllSections(undefined, (done, total, label, count) =>
      process.stdout.write(`\r${done}/${total} subjects (${label}), ${count} sections   `)
    )
      .then((r) => console.log(`\n${r.subjectsScanned} subjects scanned, ${r.sectionsCount} sections`))
      .catch((e) => { console.error("\nSchedule scrape failed:", e.message); process.exit(1); });
  } else {
    console.error(`Unknown mode "${mode}". Use "schedule", "evaluations", or "rmp".`);
    process.exit(1);
  }
}

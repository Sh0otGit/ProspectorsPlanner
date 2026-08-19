/* Two independent scrapers, deliberately not run together:
     - Schedule: every section, every subject, for one term. Meant to run
       daily -- rooms/times/instructors can change during add/drop.
     - Evaluations: every instructor's HB 2504 history, campus-wide. Meant
       to run once a semester -- eval scores only change when a new term's
       ratings get published, and a full crawl is ~40k requests (see
       CLAUDE.md), not something to repeat daily.
   Both are callable standalone (`node scrapers/run.js schedule` or
   `node scrapers/run.js evaluations`) and from server/lib/scheduler.js. */
import { db } from "./lib/db.js";
import { fetchDirectory, filterByDepartment } from "./faculty_directory.js";
import { fetchProfileEvaluationLinks } from "./profiles.js";
import { fetchEvaluation } from "./evaluations.js";
import { fetchSchedule, fetchSubjects } from "./schedule.js";

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
  for (const s of sections) upsertSection.run({ ...s, scrapedAt });
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
    // node:sqlite rejects named params that don't appear in the query, so
    // this can't be a plain spread -- `instr` also carries `rank`, which
    // isn't stored (not used anywhere yet).
    upsertInstructor.run({
      username: instr.username,
      name: instr.name,
      college: instr.college,
      department: instr.department,
      updatedAt: now,
    });
    const links = await fetchProfileEvaluationLinks(instr.username);
    for (const link of links) {
      if (evalExists.get(link.username, link.courseId)) continue; // already cached, never re-fetched
      const ev = await fetchEvaluation(link.username, link.courseId);
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
   CLI: node scrapers/run.js [schedule|evaluations] [--all]
   ===================================================================== */
if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , mode] = process.argv;
  if (mode === "evaluations") {
    scrapeAllEvaluations((done, total, label, newEvals) =>
      process.stdout.write(`\r${done}/${total} instructors (${label}), ${newEvals} new evaluations   `)
    )
      .then((r) => console.log(`\n${r.instructors} instructors scanned campus-wide, ${r.newEvaluations} new evaluations`))
      .catch((e) => { console.error("\nEvaluations scrape failed:", e.message); process.exit(1); });
  } else if (mode === "schedule" || mode === undefined) {
    scrapeAllSections(undefined, (done, total, label, count) =>
      process.stdout.write(`\r${done}/${total} subjects (${label}), ${count} sections   `)
    )
      .then((r) => console.log(`\n${r.subjectsScanned} subjects scanned, ${r.sectionsCount} sections`))
      .catch((e) => { console.error("\nSchedule scrape failed:", e.message); process.exit(1); });
  } else {
    console.error(`Unknown mode "${mode}". Use "schedule" or "evaluations".`);
    process.exit(1);
  }
}

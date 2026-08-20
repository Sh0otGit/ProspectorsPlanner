/* Scrape the public Banner 8 class schedule listing. See CLAUDE.md, "Schedule
   crawl path" for the exact two-step request recipe this replicates -- the
   critical, easy-to-miss part is that every unused sel_* filter must be sent
   twice (once as "dummy", once as "%" for its default "All" option) or the
   query silently returns zero results.

   No seats/capacity here -- confirmed absent from this public view, see
   CLAUDE.md. Only meeting time, room, and instructor are available. */
import { politeFetch } from "./lib/fetch.js";
import { decodeEntities } from "./lib/decode-entities.js";

const BASE = "https://www.goldmine.utep.edu/prod/owa";
const WILDCARD_FIELDS = [
  "sel_schd", "sel_insm", "sel_camp", "sel_levl",
  "sel_ptrm", "sel_instr", "sel_sess", "sel_attr",
];

function to24h(time12) {
  const m = time12.trim().match(/^(\d{1,2}):(\d{2})\s*([ap])\.?m\.?$/i);
  if (!m) return null;
  let [, h, min, ap] = m;
  h = parseInt(h, 10);
  if (ap.toLowerCase() === "p" && h !== 12) h += 12;
  if (ap.toLowerCase() === "a" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${min}`;
}

const SECTION_SPLIT_RE = /<th CLASS="ddtitle" scope="colgroup" >/g;
const HEADER_LINK_RE =
  /<a href="\/prod\/owa\/bwckschd\.p_disp_detail_sched\?term_in=(\d+)&amp;crn_in=(\d+)">([^<]+) - (\d+) - ([A-Z]+) (\S+) - (\S+)<\/a>/;
const FIELD_RE = (label) => new RegExp(`${label}:\\s*<\\/SPAN>([^<]+)<br`, "i");
const CAMPUS_RE = /\n\s*([A-Za-z0-9 .,'-]+?) Campus\s*<br/;
const SCHED_TYPE_RE = /\n([A-Za-z0-9 .,'()/-]+?) Schedule Type\s*<br/;
const CREDITS_RE = /([\d.]+)\s*Credits/;
// Column 2 (Time) has to allow tags: a TBA/async section's cell is
// literally `<ABBR title = "To Be Announced">TBA</ABBR>`, not plain text --
// confirmed against live data after 4,720 of 7,196 sections (65.6%,
// campus-wide) turned up with instructor_name/days/time all null. With
// `[^<]*` (no tags allowed) here, the regex engine hits the `<` of `<ABBR`
// and can't complete the match, which fails the *entire* row, not just the
// time field -- silently dropping every other column, instructor included,
// for any section Banner marks this way. `[\s\S]*?` here matches how
// columns 4 and 7 (Where, Instructors) already handle cells that can carry
// markup, since those have the same problem for different reasons (an
// online-course note, a mailto link with an icon).
//
// Column 8 (Description Text) has the same problem for a third reason:
// a section with an extra note -- "Class is taught in Spanish", "This
// section will be delivered online during scheduled times..." -- renders
// that note inside the cell separated by `<br/>` tags, e.g.
// `American Gover & Politics<br/><br/>Class is taught in Spanish<br/>`.
// Confirmed against real data: POLS 2311 CRN 12388 (Patrick Timmons) and
// CRN 15633 (Estella Valles-Garza) both fell into this and showed up as
// "Staff" even after the TBA/<ABBR> fix above, while sibling sections
// with no extra note parsed fine. This column's content is unused (only
// destructured up through index 7, Instructors) so `[\s\S]*?` here just
// has to stop failing the row, not extract anything new.
const MEETING_ROW_RE =
  /<tr>\s*<td CLASS="dddefault">([^<]*)<\/td>\s*<td CLASS="dddefault">([\s\S]*?)<\/td>\s*<td CLASS="dddefault">([^<]*)<\/td>\s*<td CLASS="dddefault">([\s\S]*?)<\/td>\s*<td CLASS="dddefault">([^<]*)<\/td>\s*<td CLASS="dddefault">([^<]*)<\/td>\s*<td CLASS="dddefault">([\s\S]*?)<\/td>\s*<td CLASS="dddefault">([\s\S]*?)<\/td>\s*<\/tr>/g;

// Exported so it's testable directly against a saved chunk -- see
// scrapers/__tests__/schedule.test.js.
export function parseSectionChunk(chunk) {
  const header = chunk.match(HEADER_LINK_RE);
  if (!header) return null;
  const [, termCode, crn, title, , subject, courseNumber, section] = header;

  const term = chunk.match(FIELD_RE("Associated Term"));
  const regDates = chunk.match(FIELD_RE("Registration Dates"));
  const campus = chunk.match(CAMPUS_RE);
  const schedType = chunk.match(SCHED_TYPE_RE);
  const credits = chunk.match(CREDITS_RE);
  // .split() on text with no " to " (seen on some non-standard section
  // types) leaves the second slot undefined, not missing -- array
  // destructuring doesn't backfill that with the default the way a plain
  // undefined argument would, and node:sqlite rejects undefined outright.
  const regParts = regDates ? regDates[1].split(" to ").map((s) => s.trim()) : [];
  const regStart = regParts[0] ?? null;
  const regEnd = regParts[1] ?? null;

  let days = null, startTime = null, endTime = null, room = null, instructorName = null;
  const meetingRows = [...chunk.matchAll(MEETING_ROW_RE)];
  if (meetingRows.length) {
    const [, , time, d, where, , , instr] = meetingRows[0];
    // "&nbsp;" (a real day-column value for an async section, not empty
    // text) doesn't trim away the way whitespace does -- .trim() alone
    // would leave it as the literal string "&nbsp;" instead of null.
    days = d.replace(/&nbsp;/gi, " ").trim() || null;
    // Time now arrives as raw cell markup (see MEETING_ROW_RE above), so
    // "TBA" has to be unwrapped from its <ABBR> tag before the tba check
    // below can see it as plain text instead of failing to match "TBA"
    // inside "<ABBR ...>TBA</ABBR>" and wrongly trying to parse that as a
    // real time.
    const timeText = time.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    const timeParts = timeText.split(" - ").map((s) => s.trim());
    if (timeParts.length === 2 && timeParts[0].toLowerCase() !== "tba") {
      startTime = to24h(timeParts[0]);
      endTime = to24h(timeParts[1]);
    }
    // Split on <br> first to drop a trailing "ADA Accessible" line the way
    // a real room cell carries it, then strip whatever tags are left --
    // a genuinely room-unassigned section's cell is the same
    // <ABBR title="To Be Announced">TBA</ABBR> markup as the Time column,
    // with no <br> in it at all, so the split alone left the raw tag text
    // in the stored room value. Confirmed against real data: 3,546
    // sections campus-wide had a literal "<ABBR...>TBA</ABBR>" string
    // where the room should be.
    room = decodeEntities(where.split(/<br/i)[0].replace(/<[^>]+>/g, "").trim()) || null;
    instructorName = decodeEntities(instr.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()) || null;
  }

  return {
    termCode,
    termLabel: term ? decodeEntities(term[1].trim()) : null,
    crn,
    subject,
    courseNumber,
    section,
    title: decodeEntities(title.trim()),
    instructorName,
    days,
    startTime,
    endTime,
    room,
    campus: campus ? decodeEntities(campus[1].trim()) : null,
    scheduleType: schedType ? decodeEntities(schedType[1].trim()) : null,
    credits: credits ? parseFloat(credits[1]) : null,
    regStart,
    regEnd,
  };
}

const SUBJECT_SELECT_RE = /<select name="sel_subj"[^>]*>([\s\S]*?)<\/select>/i;
const OPTION_VALUE_RE = /<option value="([^"]*)"/gi;

/* The term-select step (bwckgens.p_proc_term_date) turned out to be
   unnecessary for the search itself -- confirmed 2026-08-18, this app is
   fully stateless and term_in in the search POST is all that matters. It's
   only used here to read back the live subject list for that term, once
   per scrape run rather than once per subject. */
// Pure and exported so it's testable against saved markup without a live
// fetch -- see scrapers/__tests__/schedule.test.js.
export function parseSubjects(html) {
  const block = html.match(SUBJECT_SELECT_RE);
  return block ? [...block[1].matchAll(OPTION_VALUE_RE)].map((m) => m[1]).filter((v) => v && v !== "%") : [];
}

export async function fetchSubjects(term) {
  const html = await politeFetch(`${BASE}/bwckgens.p_proc_term_date`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ p_calling_proc: "bwckschd.p_disp_dyn_sched", p_term: term }),
  });
  const subjects = parseSubjects(html);
  // A real term always has ~150 subjects. Zero here means the select box's
  // markup changed, not that UTEP is offering zero subjects -- surface it
  // instead of letting scrapeAllSections report a silently empty "success".
  if (subjects.length === 0) {
    throw new Error(`fetchSubjects(${term}): found no subjects -- term page markup may have changed`);
  }
  return subjects;
}

// Pure and exported so it's testable against saved markup without a live
// fetch -- see scrapers/__tests__/schedule.test.js. Throws (rather than
// silently returning fewer/zero sections) when chunks existed but none of
// them parsed, since that means the markup changed, not that the subject
// legitimately offers nothing this term -- see fetchSchedule below.
export function parseScheduleHtml(html, term, subject) {
  const chunks = html.split(SECTION_SPLIT_RE).slice(1);
  const parsed = chunks.map(parseSectionChunk);
  const failed = parsed.filter((p) => p === null).length;
  if (chunks.length > 0 && failed === chunks.length) {
    throw new Error(
      `fetchSchedule(${term}, ${subject}): all ${chunks.length} section chunks failed to parse -- schedule markup may have changed`
    );
  }
  if (failed > 0) {
    console.error(`fetchSchedule(${term}, ${subject}): ${failed} of ${chunks.length} section chunks failed to parse, dropped`);
  }
  return parsed.filter(Boolean);
}

/* term e.g. "202710" for Fall 2026. subject e.g. "CS" -- "%" (every subject)
   confirmed to hang or vastly exceed any reasonable timeout, see CLAUDE.md;
   scrape one subject at a time via fetchSubjects()+a loop instead.
   courseNumber optional, e.g. "1301". */
export async function fetchSchedule(term, subject = "%", courseNumber = "") {
  const body = new URLSearchParams();
  body.append("term_in", term);
  body.append("sel_subj", "dummy");
  for (const f of WILDCARD_FIELDS) body.append(f, "dummy");
  body.append("sel_day", "dummy");
  body.append("sel_subj", subject);
  body.append("sel_crse", courseNumber);
  body.append("sel_title", "");
  for (const f of WILDCARD_FIELDS) body.append(f, "%");
  body.append("sel_from_cred", "");
  body.append("sel_to_cred", "");
  body.append("begin_hh", "0");
  body.append("begin_mi", "0");
  body.append("begin_ap", "a");
  body.append("end_hh", "0");
  body.append("end_mi", "0");
  body.append("end_ap", "a");

  const html = await politeFetch(`${BASE}/bwckschd.p_get_crse_unsec`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  return parseScheduleHtml(html, term, subject);
}

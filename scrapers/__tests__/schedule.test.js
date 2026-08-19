import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSectionChunk, parseSubjects, parseScheduleHtml } from "../schedule.js";

// Fixture shape confirmed against the live Banner 8 schedule listing during
// this project's build (see CLAUDE.md, "Schedule crawl path").
function sectionChunk({ regDates = "Jun 01, 2026 to Aug 24, 2026" } = {}) {
  return `
<a href="/prod/owa/bwckschd.p_disp_detail_sched?term_in=202710&amp;crn_in=27499">Data Structures - 27499 - CS 2401 - 001</a>
Associated Term: </SPAN>Fall 2026<br>
Registration Dates: </SPAN>${regDates}<br>

Main Campus<br>
Lecture Schedule Type<br>
3.000 Credits
<table>
<tr>
<td CLASS="dddefault">&nbsp;</td>
<td CLASS="dddefault">10:30 am - 11:50 am</td>
<td CLASS="dddefault">TR</td>
<td CLASS="dddefault">Chemistry and Computer Science Bldg. 1.0302<br></td>
<td CLASS="dddefault">08/24/2026</td>
<td CLASS="dddefault">12/11/2026</td>
<td CLASS="dddefault">Anantaa   Kotal (<abbr title="Primary">P</abbr>)</td>
<td CLASS="dddefault">Lecture</td>
</tr>
</table>`;
}

test("parses a complete section chunk", () => {
  const s = parseSectionChunk(sectionChunk());
  assert.equal(s.termCode, "202710");
  assert.equal(s.crn, "27499");
  assert.equal(s.subject, "CS");
  assert.equal(s.courseNumber, "2401");
  assert.equal(s.section, "001");
  assert.equal(s.title, "Data Structures");
  assert.equal(s.termLabel, "Fall 2026");
  assert.equal(s.campus, "Main"); // CAMPUS_RE's capture excludes the literal " Campus" suffix
  assert.equal(s.scheduleType, "Lecture");
  assert.equal(s.credits, 3);
  assert.equal(s.regStart, "Jun 01, 2026");
  assert.equal(s.regEnd, "Aug 24, 2026");
  assert.equal(s.days, "TR");
  assert.equal(s.startTime, "10:30");
  assert.equal(s.endTime, "11:50");
  assert.equal(s.room, "Chemistry and Computer Science Bldg. 1.0302");
});

test("collapses whitespace-mangled instructor names", () => {
  // Regression: "Anantaa   Kotal" (extra internal spaces + the <abbr> tag
  // for the "Primary" marker) is real, observed markup, not a fixture
  // artifact -- caught during this project's first full-campus scrape.
  const s = parseSectionChunk(sectionChunk());
  assert.equal(s.instructorName, "Anantaa Kotal (P)");
});

test("regression: Registration Dates with no \" to \" separator yields null, not undefined", () => {
  // node:sqlite rejects `undefined` outright; array destructuring an
  // under-length split() result produces undefined, not null. This is the
  // exact bug that crashed the full 149-subject backfill after the smaller
  // CS-only run had never hit a chunk shaped this way.
  const s = parseSectionChunk(sectionChunk({ regDates: "Jun 01, 2026" }));
  assert.equal(s.regStart, "Jun 01, 2026");
  assert.equal(s.regEnd, null);
  assert.notEqual(s.regEnd, undefined);
});

test("returns null (not throw) for a chunk with no header match", () => {
  assert.equal(parseSectionChunk("<p>not a section chunk</p>"), null);
});

test("parseSubjects reads option values, drops the wildcard", () => {
  const html = `<select name="sel_subj" multiple>
    <option value="%">All</option>
    <option value="CS">Computer Science</option>
    <option value="MATH">Mathematics</option>
  </select>`;
  assert.deepEqual(parseSubjects(html), ["CS", "MATH"]);
});

test("parseSubjects returns empty on unrecognized markup (caller decides to throw)", () => {
  assert.deepEqual(parseSubjects("<html>nothing here</html>"), []);
});

const SPLIT_MARKER = '<th CLASS="ddtitle" scope="colgroup" >';

test("parseScheduleHtml: a subject with zero sections is not an error", () => {
  assert.deepEqual(parseScheduleHtml("<html>no sections listed</html>", "202710", "XYZ"), []);
});

test("parseScheduleHtml: one bad chunk among good ones is dropped, not fatal", () => {
  const html = SPLIT_MARKER + sectionChunk() + SPLIT_MARKER + "<p>garbled</p>";
  const sections = parseScheduleHtml(html, "202710", "CS");
  assert.equal(sections.length, 1);
  assert.equal(sections[0].crn, "27499");
});

test("parseScheduleHtml: every chunk failing throws instead of returning silently empty", () => {
  // This is the "fail loudly" fix: chunks existed (the split marker fired)
  // but none parsed, which means the header markup changed -- a caller
  // treating an empty array as "this subject has 0 sections" would record
  // a clean, wrong "success".
  const html = SPLIT_MARKER + "<p>garbled 1</p>" + SPLIT_MARKER + "<p>garbled 2</p>";
  assert.throws(() => parseScheduleHtml(html, "202710", "CS"), /all 2 section chunks failed to parse/);
});

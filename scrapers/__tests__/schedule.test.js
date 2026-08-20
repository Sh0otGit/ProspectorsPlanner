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

test("regression: a TBA/async section's <ABBR>-wrapped time doesn't drop the whole row", () => {
  // Real, observed markup for an online/TBA section: Banner wraps "TBA" in
  // `<ABBR title = "To Be Announced">TBA</ABBR>`, not plain text. The old
  // Time-column pattern ([^<]*, no tags allowed) couldn't match past that
  // "<", which failed the *entire* row -- not just the time -- silently
  // dropping instructor name and days too. Confirmed at campus scale: 4,720
  // of 7,196 sections (65.6%) had come back with instructor_name null
  // before this fix, for exactly this reason.
  const chunk = `
<a href="/prod/owa/bwckschd.p_disp_detail_sched?term_in=202710&amp;crn_in=18283">Introduction to Politics - 18283 - POLS 2310 - 002</a>
Associated Term: </SPAN>Fall 2026<br>
Registration Dates: </SPAN>Mar 09, 2026 to Aug 28, 2026<br>

Main Campus<br>
Lecture Schedule Type<br>
3.000 Credits
<table>
<tr>
<td CLASS="dddefault">Class</td>
<td CLASS="dddefault"><ABBR title = "To Be Announced">TBA</ABBR></td>
<td CLASS="dddefault">&nbsp;</td>
<td CLASS="dddefault">On-Line Course ONLINE<BR /><BR />ADA Accessible</td>
<td CLASS="dddefault">Aug 24, 2026 - Dec 03, 2026</td>
<td CLASS="dddefault">Lecture (LECT)</td>
<td CLASS="dddefault">Estella Leticia Guadalupe  Valles-Garza (<ABBR title= "Primary">P</ABBR>)<a href="mailto:evalles9@utep.edu" target="x"><img src="/wtlgifs/email.gif"></a></td>
<td CLASS="dddefault">Lecture</td>
</tr>
</table>`;
  const s = parseSectionChunk(chunk);
  assert.equal(s.instructorName, "Estella Leticia Guadalupe Valles-Garza (P)");
  assert.equal(s.days, null); // real day/nbsp cell for a genuinely TBA section -- correctly null, not "&nbsp;"
  assert.equal(s.startTime, null);
  assert.equal(s.endTime, null);
  assert.equal(s.room, "On-Line Course ONLINE");
});

test("regression: a description note with <br/> tags doesn't drop the whole row", () => {
  // Real, observed markup: a section with an extra note ("Class is taught
  // in Spanish", "This section will be delivered online...") renders that
  // note in the last column separated by <br/> tags, e.g.
  // "American Gover & Politics<br/><br/>Class is taught in Spanish<br/>".
  // The old Description-column pattern ([^<]*, no tags allowed) failed
  // the *entire* row on the first "<br/>", the same failure mode as the
  // TBA/<ABBR> bug above but in the last column instead of the second.
  // Confirmed against real data: POLS 2311 CRN 12388 (Patrick Timmons)
  // still showed up as "Staff" even after that fix, while sibling
  // sections with no extra note parsed fine.
  const chunk = `
<a href="/prod/owa/bwckschd.p_disp_detail_sched?term_in=202710&amp;crn_in=12388">American Gover &amp; Politics - 12388 - POLS 2311 - 027</a>
Associated Term: </SPAN>Fall 2026<br>
Registration Dates: </SPAN>Mar 09, 2026 to Aug 28, 2026<br>

Main Campus<br>
Lecture Schedule Type<br>
3.000 Credits
<table>
<tr>
<td CLASS="dddefault">Class</td>
<td CLASS="dddefault">1:30 pm - 2:50 pm</td>
<td CLASS="dddefault">R</td>
<td CLASS="dddefault">Texas Western Hall 207<BR /><BR />ADA Accessible</td>
<td CLASS="dddefault">Aug 24, 2026 - Dec 03, 2026</td>
<td CLASS="dddefault">Lecture (LECT)</td>
<td CLASS="dddefault">Patrick   Timmons (<ABBR title= "Primary">P</ABBR>)<a href="mailto:ptimmons2@utep.edu" target="x"><img src="/wtlgifs/email.gif"></a></td>
<td CLASS="dddefault">American Gover & Politics<br/><br/>Class is taught in Spanish<br/></td>
</tr>
</table>`;
  const s = parseSectionChunk(chunk);
  assert.equal(s.instructorName, "Patrick Timmons (P)");
  assert.equal(s.days, "R");
  assert.equal(s.startTime, "13:30");
  assert.equal(s.endTime, "14:50");
  assert.equal(s.room, "Texas Western Hall 207");
});

test("regression: an <ABBR>-wrapped room doesn't leave raw tag text in room", () => {
  // Real, observed markup: a room-unassigned section's Where cell is the
  // same <ABBR title="To Be Announced">TBA</ABBR> markup as the Time
  // column, not plain text. The old room extraction split on <br> to drop
  // a trailing "ADA Accessible" line but never stripped any other tag, so
  // a cell with no <br> at all (this one) passed straight through with
  // the raw "<ABBR...>TBA</ABBR>" string stored as the room. Confirmed
  // against real data: CS 5391 CRN 15540 (Monika Akbar), and 3,546
  // sections campus-wide the same way.
  const chunk = `
<a href="/prod/owa/bwckschd.p_disp_detail_sched?term_in=202710&amp;crn_in=15540">Individual Studies - 15540 - CS 5391 - 001</a>
Associated Term: </SPAN>Fall 2026<br>
Registration Dates: </SPAN>Mar 09, 2026 to Aug 28, 2026<br>

Main Campus<br>
Independent Study Schedule Type<br>
3.000 Credits
<table>
<tr>
<td CLASS="dddefault">Class</td>
<td CLASS="dddefault"><ABBR title = "To Be Announced">TBA</ABBR></td>
<td CLASS="dddefault">&nbsp;</td>
<td CLASS="dddefault"><ABBR title = "To Be Announced">TBA</ABBR></td>
<td CLASS="dddefault">Aug 24, 2026 - Dec 03, 2026</td>
<td CLASS="dddefault">Independent Study (INDS)</td>
<td CLASS="dddefault">Monika   Akbar (<ABBR title= "Primary">P</ABBR>)<a href="mailto:makbar@utep.edu" target="x"><img src="/wtlgifs/email.gif"></a></td>
<td CLASS="dddefault">Individual Studies</td>
</tr>
</table>`;
  const s = parseSectionChunk(chunk);
  assert.equal(s.instructorName, "Monika Akbar (P)");
  assert.equal(s.room, "TBA");
  assert.equal(s.days, null);
  assert.equal(s.startTime, null);
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

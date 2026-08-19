import { test } from "node:test";
import assert from "node:assert/strict";
import { parseProfileLinks } from "../profiles.js";

// Fixture shape recorded in profiles.js's own header comment, verified
// against a live HB 2504 profile page 2026-08-18.
const PROFILE_HTML = `
<table>
<tr>
<td>Spring 2026</td>
<td>CS 2401 - Elem. Data Struct./Algorithms</td>
<td>27499</td>
<td><a class="btn btn-sm" href="CourseEval?username=jsmith&courseID=987">Evaluation</a></td>
</tr>
<tr>
<td>Fall 2025</td>
<td>UNIV 1301</td>
<td>18342</td>
<td><a class="btn btn-sm" href="CourseEval?username=jsmith&courseID=654">Evaluation</a></td>
</tr>
</table>`;

test("parses term, course code/title, CRN, and courseID out of the row", () => {
  const links = parseProfileLinks(PROFILE_HTML);
  assert.equal(links.length, 2);
  assert.deepEqual(links[0], {
    username: "jsmith",
    courseId: "987",
    termLabel: "Spring 2026",
    courseCode: "CS 2401",
    courseTitle: "Elem. Data Struct./Algorithms",
    crn: "27499",
  });
});

test("a course cell with no \" - \" separator becomes code with empty title, not a dropped row", () => {
  const links = parseProfileLinks(PROFILE_HTML);
  assert.equal(links[1].courseCode, "UNIV 1301");
  assert.equal(links[1].courseTitle, "");
});

test("an instructor with zero evaluations on file returns an empty array", () => {
  // Documented data gap, not an error -- new hires/adjuncts/small
  // suppressed sections legitimately have no HB 2504 history.
  assert.deepEqual(parseProfileLinks("<table></table>"), []);
});

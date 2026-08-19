import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEvaluationPage } from "../evaluations.js";

function evalPage({ courseTableMissingCloseTr = false } = {}) {
  const courseRows = [
    `<tr><th>Excellent</th><td>40.0</td></tr>${courseTableMissingCloseTr ? "" : "</tr>"}`,
    `<tr><th>Good</th><td>35.0</td></tr>`,
    `<tr><th>Satisfactory</th><td>15.0</td></tr>`,
    `<tr><th>Poor</th><td>5.0</td></tr>`,
    `<tr><th>Very Poor</th><td>3.0</td></tr>`,
    `<tr><th>No Response</th><td>2.0</td></tr>`,
    `<tr><th>Avg</th><td>4.05</td></tr>`,
  ].join("\n");

  return `
Response Count:</span><span class="evalTextNormal"> 42 </span>
<table class="CourseEval">
<tr><th>Excellent</th><td>55.5</td></tr>
<tr><th>Good</th><td>30.0</td></tr>
<tr><th>Satisfactory</th><td>10.0</td></tr>
<tr><th>Poor</th><td>3.0</td></tr>
<tr><th>Very Poor</th><td>1.5</td></tr>
<tr><th>No Response</th><td>0.0</td></tr>
<tr><th>Avg</th><td>4.35</td></tr>
</table>
<table class="CourseEval">
${courseRows}
</table>`;
}

test("parses response count and both instructor/course tables", () => {
  const ev = parseEvaluationPage(evalPage());
  assert.equal(ev.responseCount, 42);
  assert.equal(ev.instructor.avg, 4.35);
  assert.equal(ev.instructor.excellent, 55.5);
  assert.equal(ev.course.avg, 4.05);
  assert.equal(ev.course.excellent, 40);
});

test("regression: a missing </tr> in the course table does not break parsing", () => {
  // Documented in evaluations.js as real, observed markup -- CELL_RE
  // matches <th>/<td> pairs directly and doesn't depend on <tr> being
  // well-formed, so this must keep working even with the tag dropped.
  const ev = parseEvaluationPage(evalPage({ courseTableMissingCloseTr: true }));
  assert.equal(ev.course.excellent, 40);
  assert.equal(ev.course.avg, 4.05);
});

test("missing tables/response count yield nulls, not a throw", () => {
  const ev = parseEvaluationPage("<html>no evaluation on file</html>");
  assert.deepEqual(ev, { responseCount: null, instructor: null, course: null });
});

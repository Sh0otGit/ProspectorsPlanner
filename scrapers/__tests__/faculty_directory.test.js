import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDirectory } from "../faculty_directory.js";

// Fixture matches the exact shape recorded in faculty_directory.js's own
// header comment, verified against the live HB 2504 directory 2026-08-18.
const TWO_ROWS = `
<p class="FacultyRow">
  <a href="/Home/Profile?username=jsmith"> Smith, Jane </a>
  <span class="fst-italic"> - College of Engineering - Computer Science - Associate Professor</span>
</p>
<p class="FacultyRow">
  <a href="/Home/Profile?username=agarcia"> Garcia, Ana </a>
  <span class="fst-italic"> - College of Science - Biological Sciences - Data Science Program - Lecturer</span>
</p>
`;

test("parses username, name, college, department, rank", () => {
  const rows = parseDirectory(TWO_ROWS);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    username: "jsmith",
    name: "Smith, Jane",
    college: "College of Engineering",
    department: "Computer Science",
    rank: "Associate Professor",
  });
});

test("joins a sub-unit into department instead of dropping it", () => {
  // "College - Department - Sub-unit - Rank": department must be the
  // middle span joined, not just the first or last dash-separated piece.
  const rows = parseDirectory(TWO_ROWS);
  assert.equal(rows[1].department, "Biological Sciences - Data Science Program");
  assert.equal(rows[1].rank, "Lecturer");
});

test("collapses internal whitespace in the display name", () => {
  const html = `<p class="FacultyRow">
  <a href="/Home/Profile?username=akotal"> Kotal,   Anantaa </a>
  <span class="fst-italic"> - College of Engineering - Computer Science - Lecturer</span>
</p>`;
  const rows = parseDirectory(html);
  assert.equal(rows[0].name, "Kotal, Anantaa");
});

test("returns an empty array (not a throw) when nothing matches", () => {
  // fetchDirectory() is the one that turns this into a loud failure --
  // parseDirectory itself just reports what it found.
  assert.deepEqual(parseDirectory("<html><body>totally different markup</body></html>"), []);
});

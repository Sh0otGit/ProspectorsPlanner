import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSearchResults, parsePrereqFromDetail } from "../coursecatalog.js";

// Real response bodies, captured live 2026-09-13 via CDP network capture
// of catalog.utep.edu/course-search (search for "CS", then click into
// CS 1301 and CS 1110's own result cards) -- see coursecatalog.js's own
// header comment for the request shape that produced these.
const SEARCH_RESPONSE = {
  srcdb: "2026",
  count: 3,
  results: [
    { key: "1187", code: "CS 1101", title: "Intro to Computer Science Lab", srcdb: "2026" },
    { key: "1188", code: "CS 1110", title: "Intro to Problem Solving", srcdb: "2026" },
    { key: "1194", code: "CS 1301", title: "Intro to Computer Science", srcdb: "2026" },
  ],
};

test("parseSearchResults pulls key/code/title out of a subject search", () => {
  const courses = parseSearchResults(SEARCH_RESPONSE);
  assert.equal(courses.length, 3);
  assert.deepEqual(courses[2], { key: "1194", code: "CS 1301", title: "Intro to Computer Science" });
});

test("parseSearchResults returns an empty array for a subject with no courses", () => {
  assert.deepEqual(parseSearchResults({ srcdb: "2026", count: 0, results: [] }), []);
});

const CS1301_DETAIL = {
  key: "1194",
  code: "CS 1301",
  title: "Intro to Computer Science",
  description: "Intro to Computer Science: Topics include basic concepts...",
  description_custom:
    '<strong>3 Credit Hours</strong><br />\n<strong>3 Total Contact Hours</strong><br />\n0 Lab Hours<br />\n3 Lecture Hours<br />\n0 Other Hours<br />\n</p>\n<p><strong>Prerequisite(s):</strong> (MATH 1508 w/C or better ) OR (MATH 1310 w/C or better ) OR (MATH 2301 w/C or better ) OR (MATH 1411 w/C or better ) OR (MATH 1312 w/C or better ) OR (MATH 2313 w/C or better)</p><p><strong>Corequisite(s):</strong> CS 1101',
  srcdb: "2026",
};

const CS1110_DETAIL = {
  key: "1188",
  code: "CS 1110",
  title: "Intro to Problem Solving",
  description: "Intro to Problem Solving: The student will learn a systematic approach...",
  description_custom:
    '<strong>1 Credit Hour</strong><br />\n<strong>1 Total Contact Hour</strong><br />\n0 Lab Hours<br />\n1 Lecture Hour<br />\n0 Other Hours<br />\n</p>\n<p><strong>Major Restrictions:</strong><br />Restricted to majors of CS, LDCS',
  srcdb: "2026",
};

test("parsePrereqFromDetail extracts the real Prerequisite(s) line, tags stripped", () => {
  assert.equal(
    parsePrereqFromDetail(CS1301_DETAIL),
    "(MATH 1508 w/C or better ) OR (MATH 1310 w/C or better ) OR (MATH 2301 w/C or better ) OR (MATH 1411 w/C or better ) OR (MATH 1312 w/C or better ) OR (MATH 2313 w/C or better)"
  );
});

test("a course with no Prerequisite(s) line at all comes back null, not empty string", () => {
  // CS 1110 genuinely has no prerequisite -- confirmed live, its
  // description_custom has a "Major Restrictions" line instead, no
  // "Prerequisite(s)" text anywhere in it.
  assert.equal(parsePrereqFromDetail(CS1110_DETAIL), null);
});

test("a missing description_custom field entirely comes back null, not a throw", () => {
  assert.equal(parsePrereqFromDetail({ key: "0", code: "X 0000" }), null);
});

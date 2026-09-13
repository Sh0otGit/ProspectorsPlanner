import { test } from "node:test";
import assert from "node:assert/strict";
import { parseProfileLinks, parseProfileDetails } from "../profiles.js";

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

// Fixture shape recorded in profiles.js's own header comment, verified
// against two real HB 2504 profile pages 2026-09-13 (one fully populated,
// one with office/room/phone blank and grants "No info available").
const PROFILE_DETAIL_HTML = `
<div class="article">
    <span class="bold">Office Building:</span> Chemistry and Computer Science Building<br />
    <span class="bold">Office Room:</span> CCSB 3.1020<br />
    <span class="bold">Phone:</span> (915) 747-8015<br />
    <span class="bold">Email:</span> <a href="mailto:oamondragon@utep.edu" target="_top">oamondragon@utep.edu</a>
</div>
<div id="Bio" class="tabcontent block" role="tabpanel" aria-labelledby="bioLabel">
    <div class="col-md-9">
        <p>A real bio paragraph.</p>
    </div>
    <div class="col-md-1"><button class="tabButtons nextTab">&gt;</button></div>
</div>
<div id="Education" class="tabcontent" role="tabpanel" aria-labelledby="educationLabel">
    <div class=" col-md-9">
        <ul>
            <li>
                Ph D in Computer Engineering, University of Texas at El Paso (2004)
            </li>
        </ul>
    </div>
    <div class="col-md-1"><button class="tabButtons nextTab">&gt;</button></div>
</div>
<div id="RecentPublications" class="tabcontent" role="tabpanel" aria-labelledby="recentPublicationsLabel">
    <div class=" col-md-9">
        <p class="noInfo">No info available.</p>
    </div>
    <div class="col-md-1"><button class="tabButtons nextTab">&gt;</button></div>
</div>
<div id="AwardsHonors" class="tabcontent" role="tabpanel" aria-labelledby="grantsLabel">
    <div class=" col-md-9">
        <p class="noInfo">No info available.</p>
    </div>
    <div class="col-md-1"><button class="tabButtons nextTab">&gt;</button></div>
</div>`;

test("pulls office/room/phone/email out of the article block", () => {
  const d = parseProfileDetails(PROFILE_DETAIL_HTML);
  assert.equal(d.officeBuilding, "Chemistry and Computer Science Building");
  assert.equal(d.officeRoom, "CCSB 3.1020");
  assert.equal(d.phone, "(915) 747-8015");
  assert.equal(d.email, "oamondragon@utep.edu");
});

test("a blank office/room/phone field (span with nothing before <br>) is null, not empty string", () => {
  const blank = PROFILE_DETAIL_HTML.replace("Chemistry and Computer Science Building", "").replace("CCSB 3.1020", "");
  const d = parseProfileDetails(blank);
  assert.equal(d.officeBuilding, null);
  assert.equal(d.officeRoom, null);
});

test("a populated paragraph tab (Bio) comes back as its text", () => {
  assert.equal(parseProfileDetails(PROFILE_DETAIL_HTML).bio, "A real bio paragraph.");
});

test("a populated list tab (Education) comes back as one bulleted line per <li>", () => {
  assert.equal(
    parseProfileDetails(PROFILE_DETAIL_HTML).education,
    "- Ph D in Computer Engineering, University of Texas at El Paso (2004)"
  );
});

test("a tab whose only content is the noInfo marker (RecentPublications, AwardsHonors) is null", () => {
  const d = parseProfileDetails(PROFILE_DETAIL_HTML);
  assert.equal(d.scholarlyActivity, null);
  assert.equal(d.grants, null);
});

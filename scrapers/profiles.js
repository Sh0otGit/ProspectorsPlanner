/* Walk one instructor's HB 2504 profile: a table of every evaluation they
   have on file, labeled with term/course/CRN and a link carrying courseID,
   plus the profile fields (office, phone, email, bio, education, scholarly
   and creative activity, grants) shown alongside it -- fetched together
   since it's the same page, not a second request.
   Verified markup 2026-08-18 (evaluation table) and 2026-09-13 (profile
   fields):
     <tr>
       <td>Spring 2026</td>
       <td>CS 2401 - Elem. Data Struct./Algorithms</td>
       <td>27499</td>
       <td><a ... href="CourseEval?username=X&courseID=NNN" ...>Evaluation</a></td>
     </tr>

     <div class="article">
       <span class="bold">Office Building:</span> Chemistry and Computer Science Building<br />
       <span class="bold">Office Room:</span> CCSB 3.1020<br />
       <span class="bold">Phone:</span> (915) 747-8015<br />
       <span class="bold">Email:</span> <a href="mailto:x@utep.edu" target="_top">x@utep.edu</a>
     </div>

     <div id="Bio" class="tabcontent ...">...<div class="col-md-9">CONTENT</div>...
       <div class="col-md-1"><button class="tabButtons nextTab" ...>

   Each of the four fields above is independently present or absent per
   instructor -- confirmed against two real profiles, not assumed -- and an
   empty one renders the literal `<p class="noInfo">No info available.</p>`,
   which is the signal this file treats as "nothing on file" rather than a
   guess. */
import { politeFetch } from "./lib/fetch.js";
import { decodeEntities } from "./lib/decode-entities.js";

const BASE = "https://hb2504.utep.edu";
const ROW_RE =
  /<tr>\s*<td>([^<]+)<\/td>\s*<td>([^<]+)<\/td>\s*<td>([^<]+)<\/td>\s*<td><a[^>]*href="CourseEval\?username=([^&"]+)&courseID=(\d+)"/g;

// Pure and exported so it's testable against saved markup without a live
// fetch -- see scrapers/__tests__/profiles.test.js.
export function parseProfileLinks(html) {
  const links = [];
  for (const m of html.matchAll(ROW_RE)) {
    const [, termLabel, rawCourseCell, crn, linkUsername, courseId] = m;
    const courseCell = decodeEntities(rawCourseCell);
    const dashIdx = courseCell.indexOf(" - ");
    const courseCode = (dashIdx === -1 ? courseCell : courseCell.slice(0, dashIdx)).trim();
    const courseTitle = (dashIdx === -1 ? "" : courseCell.slice(dashIdx + 3)).trim();
    links.push({
      username: linkUsername,
      courseId,
      termLabel: termLabel.trim(),
      courseCode,
      courseTitle,
      crn: crn.trim(),
    });
  }
  return links;
}

function extractLabelValue(html, label) {
  const m = html.match(new RegExp(`<span class="bold">${label}:</span>\\s*([^<]*)<br`, "i"));
  const v = m ? m[1].trim() : "";
  return v ? decodeEntities(v) : null;
}

function extractEmail(html) {
  const m = html.match(/<span class="bold">Email:<\/span>\s*<a href="mailto:([^"]+)"/i);
  return m ? decodeEntities(m[1]) : null;
}

// Bounded by the tab's own opening div and the "go to next tab" button that
// always follows its one <div class="col-md-9"> content block -- confirmed
// against two real profiles' worth of markup, both the empty and populated
// case for each tab.
function extractTabContent(html, tabId) {
  const m = html.match(
    new RegExp(
      `<div id="${tabId}" class="tabcontent[^"]*"[^>]*>[\\s\\S]*?class="\\s*col-md-9"\\s*>([\\s\\S]*?)<\\/div>\\s*<div class="col-md-1">\\s*<button class="tabButtons nextTab"`,
      "i"
    )
  );
  return m ? m[1] : null;
}

// A noInfo paragraph is never real content -- dropped outright rather than
// kept as text. What's left (a bio paragraph, an education/grants list) is
// flattened to one line per <li>/<br>, tags stripped, entities decoded.
// null means genuinely nothing left, not an empty string, so the UI can
// tell "no data" apart from "blank field."
function tabTextFromHTML(raw) {
  if (!raw) return null;
  let s = raw.replace(/<p class="noInfo">[\s\S]*?<\/p>/gi, "");
  // Each <li>'s own inner whitespace collapses to one line before the "- "
  // marker is added -- otherwise a source <li> that wraps its text onto
  // its own line (every real profile on file does this) splits the marker
  // and the text it belongs to into two separate output lines.
  s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, inner) => "\n- " + inner.replace(/\s+/g, " ").trim());
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<[^>]+>/g, "");
  s = decodeEntities(s);
  s = s
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
  return s || null;
}

// Pure and exported for the same reason parseProfileLinks is -- testable
// against saved markup, no live fetch needed.
export function parseProfileDetails(html) {
  return {
    officeBuilding: extractLabelValue(html, "Office Building"),
    officeRoom: extractLabelValue(html, "Office Room"),
    phone: extractLabelValue(html, "Phone"),
    email: extractEmail(html),
    bio: tabTextFromHTML(extractTabContent(html, "Bio")),
    education: tabTextFromHTML(extractTabContent(html, "Education")),
    scholarlyActivity: tabTextFromHTML(extractTabContent(html, "RecentPublications")),
    grants: tabTextFromHTML(extractTabContent(html, "AwardsHonors")),
  };
}

export async function fetchInstructorProfile(username) {
  const html = await politeFetch(`${BASE}/Home/Profile?username=${encodeURIComponent(username)}`);
  // Unlike the directory or subject list, an individual instructor
  // legitimately having zero evaluations on file is a known, documented
  // data gap (new hires, adjuncts, small suppressed sections -- see
  // CLAUDE.md "Known data gaps"), not evidence the markup changed. So this
  // one stays a plain empty-array return rather than throwing.
  return { links: parseProfileLinks(html), details: parseProfileDetails(html) };
}

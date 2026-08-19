/* Walk one instructor's HB 2504 profile: a table of every evaluation they
   have on file, labeled with term/course/CRN and a link carrying courseID.
   Verified markup 2026-08-18:
     <tr>
       <td>Spring 2026</td>
       <td>CS 2401 - Elem. Data Struct./Algorithms</td>
       <td>27499</td>
       <td><a ... href="CourseEval?username=X&courseID=NNN" ...>Evaluation</a></td>
     </tr> */
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

export async function fetchProfileEvaluationLinks(username) {
  const html = await politeFetch(`${BASE}/Home/Profile?username=${encodeURIComponent(username)}`);
  // Unlike the directory or subject list, an individual instructor
  // legitimately having zero evaluations on file is a known, documented
  // data gap (new hires, adjuncts, small suppressed sections -- see
  // CLAUDE.md "Known data gaps"), not evidence the markup changed. So this
  // one stays a plain empty-array return rather than throwing.
  return parseProfileLinks(html);
}

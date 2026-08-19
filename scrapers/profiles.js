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

const BASE = "https://hb2504.utep.edu";
const ROW_RE =
  /<tr>\s*<td>([^<]+)<\/td>\s*<td>([^<]+)<\/td>\s*<td>([^<]+)<\/td>\s*<td><a[^>]*href="CourseEval\?username=([^&"]+)&courseID=(\d+)"/g;

export async function fetchProfileEvaluationLinks(username) {
  const html = await politeFetch(`${BASE}/Home/Profile?username=${encodeURIComponent(username)}`);
  const links = [];
  for (const m of html.matchAll(ROW_RE)) {
    const [, termLabel, courseCell, crn, linkUsername, courseId] = m;
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

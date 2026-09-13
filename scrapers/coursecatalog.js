/* catalog.utep.edu/course-search's FOSE (Leepfrog/CourseLeaf) JSON API --
   see CLAUDE.md's Data sources entry for this source. Confirmed live
   2026-09-13 via CDP network capture of a real search-then-click-a-result
   session against the real site, same reconnaissance technique already
   used for RMP's GraphQL and Concept3D's /locations: no auth, no cookies,
   confirmed stateless with a bare curl too.

   Two calls, both POST JSON to the same base URL with a different `route`:

   route=search, body {"other":{"srcdb":SRCDB},"criteria":[{"field":"subject","value":"CS"}]}
     -> {"srcdb":"2026","count":139,"results":[{"key":"1187","code":"CS 1101","title":"...","srcdb":"2026"}, ...]}
   One search covers a whole subject, not one call per course -- same
   "one request per subject" shape schedule.js's Banner crawl already uses.

   route=details, body {"group":"key:KEY","key":"key:KEY","srcdb":SRCDB,"matched":"key:KEY"}
     -> {"key":"1187","code":"CS 1101", ..., "description_custom":"<strong>1 Credit Hour</strong><br />...
         <p><strong>Prerequisite(s):</strong> (MATH 1508 w/C or better ) OR (MATH 1411 w/C or better)</p>..."}
   description_custom is the field that actually carries a structured
   "Prerequisite(s):" line when the course has one -- confirmed against a
   course with a real prerequisite (CS 1301) and one confirmed to have
   none at all (CS 1110, whose description_custom has no such line),
   same "field genuinely absent, not unscraped" pattern as everywhere
   else this project reads optional text out of scraped markup. */
import { politeFetch } from "./lib/fetch.js";
import { decodeEntities } from "./lib/decode-entities.js";

const BASE = "https://catalog.utep.edu/course-search/api/?page=fose";
// The catalog year (not a Banner term code -- this source is catalog-year
// granularity, see CLAUDE.md) the search page's own srcdb dropdown
// defaults to. Confirmed live 2026-09-13: "2026" is UTEP's current
// 2026-2027 catalog year. The FOSE dropdown has no "current" flag to read
// programmatically, so this needs a manual bump once a new catalog year
// rolls over -- same kind of hand-maintained constant as run.js's own
// DEFAULT_TERM.
export const DEFAULT_SRCDB = "2026";

async function fosePost(route, body) {
  const text = await politeFetch(`${BASE}&route=${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return JSON.parse(text);
}

// Pure and exported so it's testable against saved response shapes without
// a live fetch -- see scrapers/__tests__/coursecatalog.test.js.
export function parseSearchResults(data) {
  return (data.results || []).map((r) => ({ key: r.key, code: r.code, title: r.title }));
}

const PREREQ_RE = /<strong>Prerequisite\(s\):<\/strong>\s*([\s\S]*?)(?:<\/p>|<p>|$)/i;

export function parsePrereqFromDetail(data) {
  const html = data.description_custom || "";
  const m = html.match(PREREQ_RE);
  if (!m) return null;
  const text = decodeEntities(m[1].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
  return text || null;
}

export async function fetchSubjectCourses(subject, srcdb = DEFAULT_SRCDB) {
  const data = await fosePost("search", { other: { srcdb }, criteria: [{ field: "subject", value: subject }] });
  return parseSearchResults(data);
}

export async function fetchCoursePrereq(key, srcdb = DEFAULT_SRCDB) {
  const data = await fosePost("details", { group: `key:${key}`, key: `key:${key}`, srcdb, matched: `key:${key}` });
  return parsePrereqFromDetail(data);
}

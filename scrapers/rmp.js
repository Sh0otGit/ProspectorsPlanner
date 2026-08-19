/* Rate My Professors. Unlike every other data source in this project, RMP's
   own Terms of Service (Section 6, confirmed current as of the decision to
   build this) explicitly prohibit "manual or automated software, devices,
   scripts, robots or other means or processes to access, scrape, crawl or
   spider any web pages or other services contained in the site." Scraped
   anyway -- a deliberate, informed decision by the project owner after
   confirming no official API or partner program exists, not an oversight
   or a loophole. Kept to CLAUDE.md's own stated plan for this source:
   cache lightly, show aggregates plus a *bounded* sample, link back to the
   source, be ready to drop this file and its two tables entirely if it
   ever needs to go.

   No documented API exists. This talks to the same undocumented GraphQL
   endpoint (ratemyprofessors.com/graphql) the site's own frontend calls --
   found by watching real browser network traffic against the live site
   with CDP, not copied from a third-party wrapper's possibly-stale
   schema. The professor detail page turned out not to need GraphQL at
   all: it's server-rendered, with the whole Relay client store (professor
   aggregate + up to 5 reviews) embedded directly in a
   `window.__RELAY_STORE__ = {...}` script tag -- a plain HTML fetch and a
   regex, the same shape every other scraper in this project already uses. */
import { politeFetch } from "./lib/fetch.js";

const GRAPHQL_URL = "https://www.ratemyprofessors.com/graphql";

// base64("School-4058"). Found 2026-08-19 via the live school search
// (https://www.ratemyprofessors.com/search/schools?q=University+of+Texas+at+El+Paso)
// -- UTEP is RMP school id 4058, unique per school and stable.
export const UTEP_SCHOOL_ID = "U2Nob29sLTQwNTg=";

const SEARCH_QUERY = `query TeacherSearchPaginationQuery($count: Int!, $cursor: String, $query: TeacherSearchQuery!) {
  search: newSearch {
    teachers(query: $query, first: $count, after: $cursor) {
      didFallback
      edges { cursor node { id legacyId avgRating numRatings wouldTakeAgainPercent avgDifficulty firstName lastName department __typename } }
      pageInfo { hasNextPage endCursor }
      resultCount
    }
  }
}`;

async function fetchProfessorPage(cursor) {
  const body = JSON.stringify({
    query: SEARCH_QUERY,
    operationName: "TeacherSearchPaginationQuery",
    // 100 is accepted (confirmed live -- RMP's own frontend asks for 5 at
    // a time via repeated "Show More" clicks, but nothing about the query
    // caps it there); at ~2,400 professors that's ~24 requests instead of
    // ~475, which matters a lot at this project's 700ms-per-request rate limit.
    variables: { count: 100, cursor, query: { text: "", schoolID: UTEP_SCHOOL_ID, fallback: true } },
  });
  const text = await politeFetch(GRAPHQL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  const json = JSON.parse(text);
  const teachers = json?.data?.search?.teachers;
  if (!teachers) throw new Error(`fetchProfessorPage: unexpected response shape -- ${text.slice(0, 300)}`);
  return teachers;
}

/* Every professor RMP has on file for UTEP -- aggregate numbers only
   (quality, difficulty, would-take-again, response count), no review
   text yet. onProgress(done, total) fires after each page. */
export async function fetchAllProfessors(onProgress) {
  const all = [];
  let cursor = null;
  let hasNextPage = true;
  while (hasNextPage) {
    const page = await fetchProfessorPage(cursor);
    for (const edge of page.edges) all.push(edge.node);
    hasNextPage = page.pageInfo.hasNextPage;
    cursor = page.pageInfo.endCursor;
    onProgress?.(all.length, page.resultCount);
  }
  return all;
}

const RELAY_STORE_RE = /window\.__RELAY_STORE__\s*=\s*(\{[\s\S]*?\});/;

/* One professor's detail page: re-fetches the same aggregate numbers the
   list gives (kept in sync) plus whatever reviews the page embeds
   server-side -- 5, not configurable from here, which is exactly the
   "bounded sample" CLAUDE.md calls for rather than a deeper pull via the
   ratings-pagination query that would also exist. */
export async function fetchProfessorDetail(legacyId) {
  const html = await politeFetch(`https://www.ratemyprofessors.com/professor/${legacyId}`);
  const m = RELAY_STORE_RE.exec(html);
  if (!m) {
    throw new Error(`fetchProfessorDetail(${legacyId}): __RELAY_STORE__ not found -- page markup may have changed`);
  }
  const store = JSON.parse(m[1]);

  const teacher = Object.values(store).find((v) => v && v.__typename === "Teacher" && v.legacyId === legacyId);
  if (!teacher) throw new Error(`fetchProfessorDetail(${legacyId}): no Teacher node in the Relay store`);

  const reviews = Object.values(store)
    .filter((v) => v && v.__typename === "Rating")
    .map((r) => ({
      reviewId: r.legacyId,
      courseCode: r.class || null,
      date: r.date || null,
      quality: r.clarityRating ?? null,
      difficulty: r.difficultyRating ?? null,
      wouldTakeAgain: r.wouldTakeAgain, // 1 yes, 0 no, -1 not answered
      grade: r.grade || null,
      tags: r.ratingTags ? r.ratingTags.split(" --").filter(Boolean) : [],
      comment: r.comment || null,
    }));

  return {
    legacyId,
    firstName: teacher.firstName?.trim() ?? null,
    lastName: teacher.lastName?.trim() ?? null,
    department: teacher.department || null,
    avgRating: teacher.avgRating ?? null,
    numRatings: teacher.numRatings ?? null,
    wouldTakeAgainPercent: teacher.wouldTakeAgainPercent ?? null,
    avgDifficulty: teacher.avgDifficulty ?? null,
    reviews,
  };
}

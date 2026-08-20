/* Rate My Professors. Unlike every other data source in this project, RMP's
   own Terms of Service (Section 6, confirmed current as of the decision to
   build this) explicitly prohibit "manual or automated software, devices,
   scripts, robots or other means or processes to access, scrape, crawl or
   spider any web pages or other services contained in the site." Scraped
   anyway -- a deliberate, informed decision by the project owner after
   confirming no official API or partner program exists, not an oversight
   or a loophole. Kept to CLAUDE.md's own stated plan for this source:
   cache lightly, link back to the source, be ready to drop this file and
   its two tables entirely if it ever needs to go. Originally bounded to
   the ~5 reviews the professor page embeds server-side; revised 2026-08-20
   to pull every review for a matched instructor (see fetchAllRatings)
   after Monika Akbar's real 21 reviews turned up as only 5 in this site's
   own data -- see CLAUDE.md's Data sources entry for the full reasoning.

   No documented API exists. This talks to the same undocumented GraphQL
   endpoint (ratemyprofessors.com/graphql) the site's own frontend calls --
   found by watching real browser network traffic against the live site
   with CDP, not copied from a third-party wrapper's possibly-stale
   schema. The professor detail page itself doesn't need GraphQL: it's
   server-rendered, with the whole Relay client store (professor aggregate,
   rating distribution, and the first 5 reviews) embedded directly in a
   `window.__RELAY_STORE__ = {...}` script tag -- a plain HTML fetch and a
   regex, the same shape every other scraper in this project already uses.
   The rest of a professor's reviews come from the same `RatingsListQuery`
   the page's own "Load More Ratings" button calls, found the same way
   (CDP network capture, clicking that button on a live professor page). */
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

// Trimmed to the fields this project actually stores -- the real query
// captured off the "Load More Ratings" button carries dozens of fragments
// (thumbs, professor notes, flag status) this project has no use for.
const RATINGS_QUERY = `query RatingsListQuery($count: Int!, $id: ID!, $cursor: String) {
  node(id: $id) {
    ... on Teacher {
      ratings(first: $count, after: $cursor) {
        edges { node { legacyId class date clarityRating difficultyRating wouldTakeAgain grade ratingTags comment } }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`;

function teacherGlobalId(legacyId) {
  return Buffer.from(`Teacher-${legacyId}`).toString("base64");
}

function mapRating(r) {
  return {
    reviewId: r.legacyId,
    courseCode: r.class || null,
    date: r.date || null,
    quality: r.clarityRating ?? null,
    difficulty: r.difficultyRating ?? null,
    wouldTakeAgain: r.wouldTakeAgain, // 1 yes, 0 no, -1 not answered
    grade: r.grade || null,
    // "--" separates tags, but not always with a leading space -- confirmed
    // against real data, e.g. "Amazing lectures --Beware of pop
    // quizzes--Caring" mixes both, and a literal " --" split leaves the
    // second pair stuck together as one tag.
    tags: r.ratingTags ? r.ratingTags.split(/\s*--\s*/).map((t) => t.trim()).filter(Boolean) : [],
    comment: r.comment || null,
  };
}

/* Every review RMP has on file for one professor, not just the 5 the page
   embeds server-side -- pages through the same GraphQL connection the
   site's own "Load More Ratings" button calls. 100 per page confirmed
   live to return everything in one request for a professor with 22
   reviews (RMP's own frontend asks for 5 at a time via repeated clicks,
   but nothing about the query caps it there, the same finding as the
   professor-list query in fetchAllProfessors above); the loop below still
   follows pageInfo.hasNextPage for the rare professor with more than 100. */
export async function fetchAllRatings(legacyId) {
  const id = teacherGlobalId(legacyId);
  const all = [];
  let cursor = null;
  let hasNextPage = true;
  while (hasNextPage) {
    const body = JSON.stringify({
      query: RATINGS_QUERY,
      operationName: "RatingsListQuery",
      variables: { count: 100, id, cursor },
    });
    const text = await politeFetch(GRAPHQL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const json = JSON.parse(text);
    const ratings = json?.data?.node?.ratings;
    if (!ratings) throw new Error(`fetchAllRatings(${legacyId}): unexpected response shape -- ${text.slice(0, 300)}`);
    for (const edge of ratings.edges) all.push(mapRating(edge.node));
    hasNextPage = ratings.pageInfo.hasNextPage;
    cursor = ratings.pageInfo.endCursor;
  }
  return all;
}

/* One professor's detail page: the aggregate numbers and rating
   distribution the list doesn't carry, plus every review via
   fetchAllRatings above (not the 5 the page itself embeds -- those come
   back through the same query anyway, just as page 1). */
export async function fetchProfessorDetail(legacyId) {
  const html = await politeFetch(`https://www.ratemyprofessors.com/professor/${legacyId}`);
  const m = RELAY_STORE_RE.exec(html);
  if (!m) {
    throw new Error(`fetchProfessorDetail(${legacyId}): __RELAY_STORE__ not found -- page markup may have changed`);
  }
  const store = JSON.parse(m[1]);

  const teacher = Object.values(store).find((v) => v && v.__typename === "Teacher" && v.legacyId === legacyId);
  if (!teacher) throw new Error(`fetchProfessorDetail(${legacyId}): no Teacher node in the Relay store`);

  // Not inlined on the Teacher node -- it's a Relay reference to a
  // separate "ratingsDistribution" node elsewhere in the same store,
  // keyed by that ref string. r1 (awful) through r5 (awesome), the same
  // bucket counts RMP's own page graphs, so this is real distribution
  // data, not something derived from avgRating after the fact.
  const distRef = teacher.ratingsDistribution?.__ref;
  const distNode = distRef ? store[distRef] : null;
  const ratingsDistribution = distNode
    ? { r1: distNode.r1 ?? 0, r2: distNode.r2 ?? 0, r3: distNode.r3 ?? 0, r4: distNode.r4 ?? 0, r5: distNode.r5 ?? 0 }
    : null;

  const reviews = teacher.numRatings > 0 ? await fetchAllRatings(legacyId) : [];

  return {
    legacyId,
    firstName: teacher.firstName?.trim() ?? null,
    lastName: teacher.lastName?.trim() ?? null,
    department: teacher.department || null,
    avgRating: teacher.avgRating ?? null,
    numRatings: teacher.numRatings ?? null,
    wouldTakeAgainPercent: teacher.wouldTakeAgainPercent ?? null,
    avgDifficulty: teacher.avgDifficulty ?? null,
    ratingsDistribution,
    reviews,
  };
}

/* Parse one HB 2504 CourseEval page: two <table class="CourseEval"> blocks
   (instructor rating, course rating), each a set of <th>Label</th><td>Value</td>
   rows -- No Response / Excellent / Good / Satisfactory / Poor / Very Poor,
   plus an Avg row. Verified markup 2026-08-18. The course table has a known
   missing </tr> in the wild (Excellent's row); the row regex below doesn't
   depend on <tr> boundaries, so it's unaffected. */
import { politeFetch } from "./lib/fetch.js";

const BASE = "https://hb2504.utep.edu";
const TABLE_RE = /<table class="CourseEval">([\s\S]*?)<\/table>/g;
const CELL_RE = /<th>([^<]+)<\/th>\s*<td>([^<]+)<\/td>/g;
const RESPONSE_COUNT_RE = /Response Count:<\/span><span class="evalTextNormal">\s*(\d+)\s*<\/span>/;

function parseTable(block) {
  const out = {};
  for (const m of block.matchAll(CELL_RE)) out[m[1].trim()] = m[2].trim();
  const pct = (k) => (out[k] != null ? parseFloat(out[k]) : null);
  return {
    avg: out["Avg"] != null ? parseFloat(out["Avg"]) : null,
    noResponse: pct("No Response"),
    excellent: pct("Excellent"),
    good: pct("Good"),
    satisfactory: pct("Satisfactory"),
    poor: pct("Poor"),
    veryPoor: pct("Very Poor"),
  };
}

export async function fetchEvaluation(username, courseId) {
  const html = await politeFetch(
    `${BASE}/Home/CourseEval?username=${encodeURIComponent(username)}&courseID=${courseId}`
  );
  const tables = [...html.matchAll(TABLE_RE)];
  const responseMatch = html.match(RESPONSE_COUNT_RE);
  return {
    responseCount: responseMatch ? parseInt(responseMatch[1], 10) : null,
    instructor: tables[0] ? parseTable(tables[0][1]) : null,
    course: tables[1] ? parseTable(tables[1][1]) : null,
  };
}

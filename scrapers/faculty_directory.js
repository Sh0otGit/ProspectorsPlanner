/* Crawl the HB 2504 A-to-Z faculty directory: one request, ~2000 rows.
   Verified markup 2026-08-18:
     <p class="FacultyRow">
       <a href="/Home/Profile?username=X"> Last, First </a>
       <span class="fst-italic"> - College - Department[ - Sub-unit] - Rank</span>
     </p> */
import { politeFetch } from "./lib/fetch.js";

const BASE = "https://hb2504.utep.edu";
const ROW_RE =
  /<p class="FacultyRow">\s*<a href="\/Home\/Profile\?username=([^"]+)">\s*([^<]+?)\s*<\/a>\s*<span class="fst-italic">\s*-\s*([^<]+?)<\/span>/g;

// Pure and exported so it's testable against saved markup without a live
// fetch -- see scrapers/__tests__/faculty_directory.test.js.
export function parseDirectory(html) {
  const rows = [];
  for (const m of html.matchAll(ROW_RE)) {
    const [, username, rawName, rawMeta] = m;
    const name = rawName.replace(/\s+/g, " ").trim();
    const parts = rawMeta.split(" - ").map((s) => s.trim());
    rows.push({
      username,
      name,
      college: parts[0] || "",
      department: parts.slice(1, -1).join(" - "),
      rank: parts[parts.length - 1] || "",
    });
  }
  return rows;
}

export async function fetchDirectory() {
  const html = await politeFetch(BASE + "/");
  const rows = parseDirectory(html);
  // The campus-wide directory is ~2000 rows and never legitimately empty --
  // zero means ROW_RE stopped matching (markup changed), not "no faculty."
  // A silent empty return here would make scrapeAllEvaluations report a
  // clean "0 instructors, 0 new evaluations" run instead of failing.
  if (rows.length === 0) {
    throw new Error("fetchDirectory(): found no faculty rows -- HB 2504 directory markup may have changed");
  }
  return rows;
}

export function filterByDepartment(rows, needle) {
  const lower = needle.toLowerCase();
  return rows.filter((r) => r.department.toLowerCase().includes(lower));
}

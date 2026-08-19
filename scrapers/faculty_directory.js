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

export async function fetchDirectory() {
  const html = await politeFetch(BASE + "/");
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

export function filterByDepartment(rows, needle) {
  const lower = needle.toLowerCase();
  return rows.filter((r) => r.department.toLowerCase().includes(lower));
}

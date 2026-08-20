/* Data browser: two independent search UIs against the raw scraped tables,
   not the blended/shrunk scores the public site shows -- this is for
   checking what's actually in the database, deciding whether the scraper
   needs to be widened, and re-running it. */

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Highlights every occurrence of every whitespace-separated query token,
// not just the first token that happens to match. A query like "Human-
// Machine Intelligence" has to light up both "Human-Machine" and
// "Intelligence" wherever either appears -- returning after the first hit
// (the original approach) left every token after the first dark.
function highlight(text, q) {
  const s = escapeHtml(String(text ?? ""));
  if (!q) return s;
  const tokens = q.split(/\s+/).filter(Boolean).map(escapeRegex);
  if (!tokens.length) return s;
  const re = new RegExp("(" + tokens.join("|") + ")", "gi");
  return s.replace(re, "<mark>$1</mark>");
}

// Summary content is exactly two flex items -- the chevron+label grouped
// together on the left, and the count on the right -- so space-between
// pushes those two apart instead of spacing out every word or <mark>
// inside the label (which happened when they were all separate flex
// children of the summary itself).
function groupSummary(labelHtml, countHtml) {
  return `<span class="row-left"><span class="chev">&#9656;</span><span class="lbl">${labelHtml}</span></span><span class="count">${countHtml}</span>`;
}

function fmtTime(t) {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const ap = h >= 12 ? "p.m." : "a.m.";
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ap}`;
}

// « first, ‹ back, the current page number (plain, not a button list), ›
// forward, » last -- same control the public site uses for RMP review
// pagination (prototype/js/page-instructors.js), reused here via data-*
// attributes a delegated click listener reads instead of per-button closures.
function pagerHTML(page, pages, kind, key) {
  if (pages <= 1) return "";
  const nav = (i, label, disabled) =>
    `<button data-pager="${kind}" data-key="${escapeHtml(key)}" data-page="${i}"${disabled ? " disabled" : ""}>${label}</button>`;
  return (
    '<div class="revpages">' +
    nav(0, "&laquo;", page === 0) +
    nav(Math.max(0, page - 1), "&lsaquo;", page === 0) +
    `<span class="pgnum">${page + 1}</span>` +
    nav(Math.min(pages - 1, page + 1), "&rsaquo;", page === pages - 1) +
    nav(pages - 1, "&raquo;", page === pages - 1) +
    "</div>"
  );
}
function pagerNavHTML(page, pages, kind, key) {
  if (pages <= 1) return "";
  return `<div class="revnav"><span class="pg">Page ${page + 1} of ${pages}</span><span class="spacer"></span>${pagerHTML(page, pages, kind, key)}</div>`;
}

/* =====================================================================
   Classes: fetched once, grouped and filtered entirely client-side.
   ===================================================================== */
let allSections = [];

function matchesQuery(s, q) {
  if (!q) return true;
  const hay = `${s.subject} ${s.course_number} ${s.title} ${s.instructor_name || ""}`.toLowerCase();
  return hay.includes(q);
}

function instructorCell(name, q) {
  if (!name) return "Staff";
  // Clicking a name jumps to the Professors panel and searches it there,
  // rather than duplicating instructor profile data into the class view.
  return `<button class="instr-link" data-name="${escapeHtml(name)}">${highlight(name, q)}</button>`;
}

function renderClassTree(q) {
  const tree = document.getElementById("classTree");
  const filtered = allSections.filter((s) => matchesQuery(s, q));

  if (!allSections.length) {
    tree.innerHTML = '<div class="empty">No sections scraped yet. Run the schedule scraper from Ingestion.</div>';
    return;
  }
  if (!filtered.length) {
    tree.innerHTML = '<div class="empty">No sections match that search.</div>';
    return;
  }

  // term_label -> subject -> course_number -> [sections]
  const terms = new Map();
  for (const s of filtered) {
    const term = s.term_label || s.term_code || "Unknown term";
    if (!terms.has(term)) terms.set(term, new Map());
    const subjects = terms.get(term);
    if (!subjects.has(s.subject)) subjects.set(s.subject, new Map());
    const courses = subjects.get(s.subject);
    const key = s.course_number;
    if (!courses.has(key)) courses.set(key, []);
    courses.get(key).push(s);
  }

  const open = q ? " open" : "";
  let html = "";
  for (const [term, subjects] of terms) {
    const subjectCount = subjects.size;
    let sectionCount = 0;
    let subjHtml = "";
    for (const [subject, courses] of subjects) {
      let courseSectionCount = 0;
      let courseHtml = "";
      for (const [courseNum, sections] of courses) {
        courseSectionCount += sections.length;
        const title = sections[0].title;
        const rows = sections
          .map(
            (s) => `
          <tr>
            <td>${escapeHtml(s.section || "")}</td>
            <td>${instructorCell(s.instructor_name, q)}</td>
            <td>${escapeHtml((s.days || "") + " " + (s.start_time ? fmtTime(s.start_time) + "–" + fmtTime(s.end_time) : "TBA"))}</td>
            <td>${escapeHtml(s.room || "")}</td>
            <td>${escapeHtml(s.campus || "")}</td>
            <td>${escapeHtml(s.schedule_type || "")}</td>
            <td>${s.credits ?? ""}</td>
            <td><code>${escapeHtml(s.crn)}</code></td>
            <td>${escapeHtml(s.reg_start || "")}${s.reg_end ? " – " + escapeHtml(s.reg_end) : ""}</td>
          </tr>`
          )
          .join("");
        const label = `${escapeHtml(subject)} ${highlight(courseNum, q)} &middot; ${highlight(title, q)}`;
        const count = `${sections.length} section${sections.length === 1 ? "" : "s"}`;
        courseHtml += `
          <details class="course-group"${open}>
            <summary>${groupSummary(label, count)}</summary>
            <div class="course-body">
              <table class="admin-table">
                <thead><tr><th>Sec</th><th>Instructor</th><th>Meets</th><th>Room</th><th>Campus</th><th>Type</th><th>Cr.</th><th>CRN</th><th>Reg. dates</th></tr></thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
          </details>`;
      }
      sectionCount += courseSectionCount;
      const subjCount = `${courses.size} course${courses.size === 1 ? "" : "s"}, ${courseSectionCount} section${courseSectionCount === 1 ? "" : "s"}`;
      subjHtml += `
        <details class="subj-group"${open}>
          <summary>${groupSummary(highlight(subject, q), subjCount)}</summary>
          ${courseHtml}
        </details>`;
    }
    const termCount = `${subjectCount} subject${subjectCount === 1 ? "" : "s"}, ${sectionCount} section${sectionCount === 1 ? "" : "s"}`;
    html += `
      <details class="term-group"${open}>
        <summary>${groupSummary(escapeHtml(term), termCount)}</summary>
        ${subjHtml}
      </details>`;
  }
  tree.innerHTML = html;
}

async function loadClasses() {
  const hint = document.getElementById("classHint");
  try {
    const res = await adminFetch("/admin/api/data/classes");
    const { sections } = await res.json();
    allSections = sections;
    hint.textContent = `${sections.length.toLocaleString()} sections loaded.`;
    renderClassTree("");
  } catch {
    hint.textContent = "Couldn't load class data.";
  }
}

let classSearchTimer;
document.getElementById("classSearch").addEventListener("input", (e) => {
  clearTimeout(classSearchTimer);
  const q = e.target.value.trim().toLowerCase();
  classSearchTimer = setTimeout(() => renderClassTree(q), 120);
});

// Clicking an instructor's name in the class table searches for them in
// the Professors panel instead of duplicating profile data here.
document.getElementById("classTree").addEventListener("click", (e) => {
  const btn = e.target.closest(".instr-link");
  if (!btn) return;
  // The schedule scraper stores Banner's raw "First Last (P)" text --
  // the "(P)" primary-instructor marker isn't part of anyone's actual
  // name and won't appear anywhere in the HB 2504-sourced instructors
  // table, so it has to be stripped before searching or it'd guarantee
  // zero matches (see the server-side token match below, which requires
  // every word in the query to appear somewhere).
  const name = btn.dataset.name.replace(/\s*\([^)]*\)\s*$/, "").trim();
  const input = document.getElementById("profSearch");
  input.value = name;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.scrollIntoView({ behavior: "smooth", block: "center" });
  input.focus();
});

/* =====================================================================
   Professors: server-searched, one request per query. Both the list of
   matching instructors and each instructor's evaluation list get their
   own pagination -- a broad search can match up to 30 people, and a
   long-tenured instructor can have dozens of evaluations on file.
   ===================================================================== */
const PROF_PAGE_SIZE = 5;
const EVAL_PAGE_SIZE = 5;
let lastInstructors = [];
let lastQuery = "";
let resultsPage = 0;
let evalPageByUsername = {};

const RATING_BUCKETS = [
  ["excellent", "Excellent", "--r5"],
  ["good", "Good", "--r4"],
  ["satisfactory", "Satisfactory", "--r3"],
  ["poor", "Poor", "--r2"],
  ["verypoor", "Very poor", "--r1"],
  ["noresponse", "No response", "--rule-strong"],
];

function ratingBreakdownHTML(e, prefix) {
  return (
    '<div class="ratingbreak">' +
    RATING_BUCKETS.map(([key, label, colorVar]) => {
      const v = e[`${prefix}_${key}`];
      return `<div><span class="swatch" style="background:var(${colorVar})"></span>${label}<b>${v ?? "N/A"}</b></div>`;
    }).join("") +
    "</div>"
  );
}

function evalRowHTML(e) {
  return `
    <div class="evalrow">
      <div class="top">
        <span class="course">${escapeHtml(e.course_code || "")} ${escapeHtml(e.course_title || "")}</span>
        <span class="term">${escapeHtml(e.term_label || "")} &middot; CRN ${escapeHtml(e.crn || "")}</span>
      </div>
      <div class="avgs">
        <span>Instructor avg <b>${e.instructor_avg ?? "N/A"}</b> (n=${e.instructor_n ?? "N/A"})</span>
        <span>Course avg <b>${e.course_avg ?? "N/A"}</b></span>
      </div>
      <div class="ratingtoggles">
        <details><summary>Instructor ratings</summary>${ratingBreakdownHTML(e, "instructor")}</details>
        <details><summary>Course ratings</summary>${ratingBreakdownHTML(e, "course")}</details>
      </div>
    </div>`;
}

function profCardHTML(p, q) {
  const page = evalPageByUsername[p.username] || 0;
  const pages = Math.max(1, Math.ceil(p.evaluations.length / EVAL_PAGE_SIZE));
  const slice = p.evaluations.slice(page * EVAL_PAGE_SIZE, page * EVAL_PAGE_SIZE + EVAL_PAGE_SIZE);
  const evalsHtml = p.evaluations.length
    ? slice.map(evalRowHTML).join("") + pagerNavHTML(page, pages, "evals", p.username)
    : '<div class="empty">No evaluations on file for this instructor.</div>';

  return `
    <div class="profcard">
      <header>
        <div class="nm">${highlight(p.name, q)}</div>
        <div class="meta">${highlight(p.username, q)} &middot; ${highlight(p.college || "", q)}${p.department ? " &middot; " + highlight(p.department, q) : ""}</div>
      </header>
      <div class="pad">
        <div style="font-size:12px;color:var(--ink-muted);margin-bottom:8px">${p.evaluations.length} evaluation${p.evaluations.length === 1 ? "" : "s"} on file</div>
        ${evalsHtml}
      </div>
    </div>`;
}

function renderProfResults() {
  const box = document.getElementById("profResults");
  if (!lastInstructors.length) {
    box.innerHTML = '<div class="empty">No matching instructors.</div>';
    return;
  }
  const pages = Math.max(1, Math.ceil(lastInstructors.length / PROF_PAGE_SIZE));
  if (resultsPage > pages - 1) resultsPage = pages - 1;
  const slice = lastInstructors.slice(resultsPage * PROF_PAGE_SIZE, resultsPage * PROF_PAGE_SIZE + PROF_PAGE_SIZE);
  box.innerHTML =
    slice.map((p) => profCardHTML(p, lastQuery)).join("") + pagerNavHTML(resultsPage, pages, "results", "");
}

document.getElementById("profResults").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-pager]");
  if (!btn || btn.disabled) return;
  const page = +btn.dataset.page;
  if (btn.dataset.pager === "results") {
    resultsPage = page;
  } else if (btn.dataset.pager === "evals") {
    evalPageByUsername[btn.dataset.key] = page;
  }
  renderProfResults();
});

let profSearchTimer;
document.getElementById("profSearch").addEventListener("input", (e) => {
  clearTimeout(profSearchTimer);
  const q = e.target.value.trim();
  const hint = document.getElementById("profHint");
  if (q.length < 2) {
    hint.textContent = "Type at least 2 characters to search.";
    document.getElementById("profResults").innerHTML = "";
    return;
  }
  hint.textContent = "Searching…";
  profSearchTimer = setTimeout(async () => {
    try {
      const res = await adminFetch("/admin/api/data/instructors?q=" + encodeURIComponent(q));
      const { instructors } = await res.json();
      lastInstructors = instructors;
      lastQuery = q;
      resultsPage = 0;
      evalPageByUsername = {};
      hint.textContent = `${instructors.length} match${instructors.length === 1 ? "" : "es"}.`;
      renderProfResults();
    } catch {
      hint.textContent = "Couldn't search instructors.";
    }
  }, 300);
});

loadClasses();

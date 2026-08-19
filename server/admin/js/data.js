/* Data browser: two independent search UIs against the raw scraped tables,
   not the blended/shrunk scores the public site shows -- this is for
   checking what's actually in the database, deciding whether the scraper
   needs to be widened, and re-running it. */

// A query like "CS 3350" only ever appears whole in the *combined* search
// text (subject + course number + title + instructor) -- individual
// displayed fields only ever contain one token of it ("CS" here, "3350"
// there). Highlighting the literal full query against each field
// separately would never match anything for a multi-word query, so this
// tries each whitespace-separated token and highlights the first one that
// actually appears in this particular field.
function highlight(text, q) {
  const s = escapeHtml(String(text ?? ""));
  if (!q) return s;
  const tokens = q.split(/\s+/).filter(Boolean);
  for (const tok of tokens) {
    const idx = s.toLowerCase().indexOf(tok.toLowerCase());
    if (idx !== -1) {
      return s.slice(0, idx) + "<mark>" + s.slice(idx, idx + tok.length) + "</mark>" + s.slice(idx + tok.length);
    }
  }
  return s;
}

function fmtTime(t) {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const ap = h >= 12 ? "p.m." : "a.m.";
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ap}`;
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
    let subjectCount = subjects.size;
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
            <td>${highlight(s.instructor_name || "Staff", q)}</td>
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
        courseHtml += `
          <details class="course-group"${open}>
            <summary>${escapeHtml(subject)} ${highlight(courseNum, q)} &mdash; ${highlight(title, q)}
              <span class="count">${sections.length} section${sections.length === 1 ? "" : "s"}</span>
            </summary>
            <div class="course-body">
              <table class="admin-table">
                <thead><tr><th>Sec</th><th>Instructor</th><th>Meets</th><th>Room</th><th>Campus</th><th>Type</th><th>Cr.</th><th>CRN</th><th>Reg. dates</th></tr></thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
          </details>`;
      }
      sectionCount += courseSectionCount;
      subjHtml += `
        <details class="subj-group"${open}>
          <summary>${highlight(subject, q)} <span class="count">${courses.size} course${courses.size === 1 ? "" : "s"}, ${courseSectionCount} section${courseSectionCount === 1 ? "" : "s"}</span></summary>
          ${courseHtml}
        </details>`;
    }
    html += `
      <details class="term-group"${open}>
        <summary>${escapeHtml(term)} <span class="count">${subjectCount} subject${subjectCount === 1 ? "" : "s"}, ${sectionCount} section${sectionCount === 1 ? "" : "s"}</span></summary>
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

/* =====================================================================
   Professors: server-searched, one request per query.
   ===================================================================== */
function renderProfResults(instructors, q) {
  const box = document.getElementById("profResults");
  if (!instructors.length) {
    box.innerHTML = '<div class="empty">No matching instructors.</div>';
    return;
  }
  box.innerHTML = instructors
    .map((p) => {
      const evalRows = p.evaluations.length
        ? p.evaluations
            .map(
              (e) => `
        <div class="evalrow">
          <div class="top">
            <span class="course">${escapeHtml(e.course_code || "")} ${escapeHtml(e.course_title || "")}</span>
            <span class="term">${escapeHtml(e.term_label || "")} &middot; CRN ${escapeHtml(e.crn || "")}</span>
          </div>
          <div class="nums">
            <span>Instructor avg <b>${e.instructor_avg ?? "—"}</b> (n=${e.instructor_n ?? "—"})</span>
            <span>Excellent <b>${e.instructor_excellent ?? "—"}</b></span>
            <span>Good <b>${e.instructor_good ?? "—"}</b></span>
            <span>Satisfactory <b>${e.instructor_satisfactory ?? "—"}</b></span>
            <span>Poor <b>${e.instructor_poor ?? "—"}</b></span>
            <span>Very poor <b>${e.instructor_verypoor ?? "—"}</b></span>
            <span>No response <b>${e.instructor_noresponse ?? "—"}</b></span>
          </div>
          <div class="nums">
            <span>Course avg <b>${e.course_avg ?? "—"}</b></span>
            <span>Excellent <b>${e.course_excellent ?? "—"}</b></span>
            <span>Good <b>${e.course_good ?? "—"}</b></span>
            <span>Satisfactory <b>${e.course_satisfactory ?? "—"}</b></span>
            <span>Poor <b>${e.course_poor ?? "—"}</b></span>
            <span>Very poor <b>${e.course_verypoor ?? "—"}</b></span>
            <span>No response <b>${e.course_noresponse ?? "—"}</b></span>
          </div>
        </div>`
            )
            .join("")
        : '<div class="empty">No evaluations on file for this instructor.</div>';

      return `
      <div class="profcard">
        <header>
          <div class="nm">${highlight(p.name, q)}</div>
          <div class="meta">${highlight(p.username, q)} &middot; ${highlight(p.college || "", q)}${p.department ? " &middot; " + highlight(p.department, q) : ""}</div>
        </header>
        <div class="pad">
          <div style="font-size:12px;color:var(--ink-muted);margin-bottom:8px">${p.evaluations.length} evaluation${p.evaluations.length === 1 ? "" : "s"} on file</div>
          ${evalRows}
        </div>
      </div>`;
    })
    .join("");
}

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
      hint.textContent = `${instructors.length} match${instructors.length === 1 ? "" : "es"}.`;
      renderProfResults(instructors, q);
    } catch {
      hint.textContent = "Couldn't search instructors.";
    }
  }, 300);
});

loadClasses();

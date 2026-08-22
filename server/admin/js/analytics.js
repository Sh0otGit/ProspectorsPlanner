// Matches ANALYTICS_PAGE's derivation in prototype/js/app.js (the URL's
// filename without ".html"). Anything not in this map (a page added later,
// or a raw 404/500) just gets its key title-cased instead of failing.
const PAGE_LABELS = {
  index: "Start", courses: "Courses", availability: "Availability",
  instructors: "Instructors", schedule: "Schedule", map: "Map",
  methodology: "Methodology", privacy: "Privacy", terms: "Terms of use",
  accessibility: "Accessibility", report: "Report a problem",
};
function pageLabel(key) {
  return PAGE_LABELS[key] || (key ? key[0].toUpperCase() + key.slice(1) : "Unknown");
}

function barListHTML(rows, { labelOf, getValue = (r) => r.n, suffix = "", max } = {}) {
  if (!rows.length) return '<div class="empty">No data in this window yet.</div>';
  const peak = max ?? Math.max(...rows.map(getValue), 1);
  return '<div class="barlist">' + rows.map((r) => {
    const n = getValue(r);
    const pct = peak ? Math.max(2, Math.round((n / peak) * 100)) : 0;
    return `<div class="row">
      <span class="lbl">${escapeHtml(labelOf(r))}</span>
      <span class="track"><span class="fill" style="width:${pct}%"></span></span>
      <span class="n">${n.toLocaleString()}${suffix}</span>
    </div>`;
  }).join("") + "</div>";
}

let currentDays = 30;

async function load(days) {
  currentDays = days;
  $$(".rangepicker button").forEach((b) => b.classList.toggle("on", +b.dataset.days === days));

  const res = await adminFetch("/admin/api/analytics?days=" + days);
  const data = await res.json();

  document.getElementById("statSessions").textContent = data.totalSessions.toLocaleString();
  document.getElementById("statEvents").textContent = data.totalEvents.toLocaleString();
  document.getElementById("statCopyCrn").textContent = data.copyCrnCount.toLocaleString();
  document.getElementById("statAddToSchedule").textContent = data.addToScheduleCount.toLocaleString();
  document.getElementById("statRoutesTab").textContent = data.routesTabViews.toLocaleString();

  document.getElementById("funnelList").innerHTML = barListHTML(data.funnel, {
    labelOf: (r) => pageLabel(r.page),
    getValue: (r) => r.sessions,
  });

  document.getElementById("pageViewsList").innerHTML = barListHTML(data.pageViews, {
    labelOf: (r) => pageLabel(r.key),
  });

  document.getElementById("durationList").innerHTML = barListHTML(data.avgDurationMsByPage, {
    labelOf: (r) => pageLabel(r.page),
    getValue: (r) => Math.round(r.avgMs / 1000),
    suffix: "s",
  });

  document.getElementById("outboundList").innerHTML = barListHTML(data.outboundLinks, {
    labelOf: (r) => r.key,
  });
}

function $$(sel) { return [...document.querySelectorAll(sel)]; }

document.getElementById("rangePicker").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-days]");
  if (b) load(+b.dataset.days);
});

load(currentDays);

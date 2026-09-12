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
function truncateLabel(s, max = 26) {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/* ---------- charts ----------
   Three small inline-SVG chart types, no library (this project has zero
   npm dependencies, see CLAUDE.md) -- a category-per-row dot plot, a
   vertical column chart, and a category-per-row horizontal bar chart.
   All three share the same "rows + label/value accessors" shape so the
   caller doesn't need to reshape data just to plot it. */

function chartEmptyHTML() {
  return '<div class="empty">No data in this window yet.</div>';
}

// Dot plot: one row per category, a dot placed along a shared value axis.
function dotPlotSVG(rows, { labelOf, getValue = (r) => r.n, suffix = "" } = {}) {
  if (!rows.length) return chartEmptyHTML();
  const rowH = 28, padTop = 10, padBottom = 10, labelW = 150, valueW = 56, chartW = 640;
  const trackX0 = labelW, trackX1 = chartW - valueW;
  const trackW = trackX1 - trackX0;
  const peak = Math.max(...rows.map(getValue), 1);
  const h = rows.length * rowH + padTop + padBottom;
  const body = rows.map((r, i) => {
    const y = padTop + i * rowH + rowH / 2;
    const val = getValue(r);
    const x = trackX0 + (peak ? (val / peak) * trackW : 0);
    return `<line class="chart-stem" x1="${trackX0}" y1="${y}" x2="${x}" y2="${y}"></line>
      <circle class="chart-dot" cx="${x}" cy="${y}" r="5"></circle>
      <text class="chart-lbl" x="${labelW - 10}" y="${y}" text-anchor="end">${escapeHtml(truncateLabel(labelOf(r)))}</text>
      <text class="chart-val" x="${chartW - 6}" y="${y}" text-anchor="end">${val.toLocaleString()}${suffix}</text>`;
  }).join("");
  return `<svg class="chart" viewBox="0 0 ${chartW} ${h}" role="img" aria-label="Page views by page">
    <line class="chart-axis" x1="${trackX0}" y1="0" x2="${trackX0}" y2="${h}"></line>
    ${body}
  </svg>`;
}

// Column chart: one vertical bar per category, height proportional to value.
function columnChartSVG(rows, { labelOf, getValue, suffix = "" } = {}) {
  if (!rows.length) return chartEmptyHTML();
  const chartW = 640, chartH = 260;
  const padL = 8, padR = 8, padTop = 22, padBottom = 76; // padBottom leaves room for rotated labels
  const plotW = chartW - padL - padR, plotH = chartH - padTop - padBottom;
  const peak = Math.max(...rows.map(getValue), 1);
  const gap = 12;
  const barW = Math.max(10, (plotW - gap * (rows.length - 1)) / rows.length);
  const baseY = padTop + plotH;
  const body = rows.map((r, i) => {
    const val = getValue(r);
    const barH = peak ? Math.max(1, (val / peak) * plotH) : 0;
    const x = padL + i * (barW + gap);
    const cx = x + barW / 2;
    const y = baseY - barH;
    return `<rect class="chart-col" x="${x}" y="${y}" width="${barW}" height="${barH}"></rect>
      <text class="chart-val" x="${cx}" y="${y - 6}" text-anchor="middle">${val.toLocaleString()}${suffix}</text>
      <text class="chart-lbl" x="${cx}" y="${baseY + 14}" text-anchor="end" transform="rotate(-40 ${cx} ${baseY + 14})">${escapeHtml(truncateLabel(labelOf(r)))}</text>`;
  }).join("");
  return `<svg class="chart" viewBox="0 0 ${chartW} ${chartH}" role="img" aria-label="Average time on page">
    <line class="chart-axis" x1="${padL}" y1="${baseY}" x2="${padL + plotW}" y2="${baseY}"></line>
    ${body}
  </svg>`;
}

// Horizontal bar chart: one row per category, bar length proportional to value.
function hBarChartSVG(rows, { labelOf, getValue = (r) => r.n } = {}) {
  if (!rows.length) return chartEmptyHTML();
  // Outbound hrefs run long and proportional-font width varies by content
  // (three "w"s in "www" is wider than the same character count elsewhere)
  // -- a tighter cutoff than the other two charts' short page names, so a
  // wide label can't run past the SVG's left edge and clip.
  const rowH = 28, padTop = 10, padBottom = 10, labelW = 170, labelMax = 20, valueW = 50, chartW = 640;
  const trackX0 = labelW, trackX1 = chartW - valueW;
  const trackW = trackX1 - trackX0;
  const barH = rowH - 10;
  const peak = Math.max(...rows.map(getValue), 1);
  const h = rows.length * rowH + padTop + padBottom;
  const body = rows.map((r, i) => {
    const y = padTop + i * rowH + (rowH - barH) / 2;
    const val = getValue(r);
    const w = peak ? Math.max(2, (val / peak) * trackW) : 0;
    return `<rect class="chart-bar" x="${trackX0}" y="${y}" width="${w}" height="${barH}"></rect>
      <text class="chart-lbl" x="${labelW - 10}" y="${y + barH / 2}" text-anchor="end">${escapeHtml(truncateLabel(labelOf(r), labelMax))}</text>
      <text class="chart-val" x="${chartW - 6}" y="${y + barH / 2}" text-anchor="end">${val.toLocaleString()}</text>`;
  }).join("");
  return `<svg class="chart" viewBox="0 0 ${chartW} ${h}" role="img" aria-label="Outbound link clicks">
    <line class="chart-axis" x1="${trackX0}" y1="0" x2="${trackX0}" y2="${h}"></line>
    ${body}
  </svg>`;
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

  document.getElementById("pageViewsChart").innerHTML = dotPlotSVG(data.pageViews, {
    labelOf: (r) => pageLabel(r.key),
  });

  document.getElementById("durationChart").innerHTML = columnChartSVG(data.avgDurationMsByPage, {
    labelOf: (r) => pageLabel(r.page),
    getValue: (r) => Math.round(r.avgMs / 1000),
    suffix: "s",
  });

  document.getElementById("outboundChart").innerHTML = hBarChartSVG(data.outboundLinks, {
    labelOf: (r) => r.key,
  });
}

function $$(sel) { return [...document.querySelectorAll(sel)]; }

document.getElementById("rangePicker").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-days]");
  if (b) load(+b.dataset.days);
});

load(currentDays);

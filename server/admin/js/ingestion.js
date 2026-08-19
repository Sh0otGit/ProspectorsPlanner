const nextAutoRunAt = { schedule: null, evaluations: null };

function fmtDate(iso) {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function fmtCountdown(target) {
  const ms = target - new Date();
  if (ms <= 0) return "Due now";
  const days = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (days > 0) return `${days}d ${h}h`;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function loadStatus() {
  const res = await adminFetch("/admin/api/status");
  const data = await res.json();

  for (const kind of ["schedule", "evaluations"]) {
    const k = kind === "schedule" ? "sched" : "eval";
    const info = data[kind];
    document.getElementById(`${k}Status`).textContent = info.running ? "Running" : "Idle";
    nextAutoRunAt[kind] = new Date(info.nextAutoRunAt);
    document.getElementById(`${k}Next`).textContent = fmtCountdown(nextAutoRunAt[kind]);

    if (info.lastRun) {
      document.getElementById(`${k}Last`).textContent = fmtDate(info.lastRun.started_at);
      document.getElementById(`${k}LastSub`).textContent =
        info.lastRun.status === "error" ? "Last run failed" : (info.lastRun.summary || "");
    } else {
      document.getElementById(`${k}Last`).textContent = "Never";
    }

    const btn = document.getElementById(kind === "schedule" ? "rescrapeSchedBtn" : "rescrapeEvalBtn");
    btn.disabled = info.running;
    btn.textContent = info.running ? "Running…" : (kind === "schedule" ? "Rescrape schedule now" : "Rescrape evaluations now");

    const progressWrap = document.getElementById(`${k}Progress`);
    if (info.running && info.lastRun && info.lastRun.progress_total) {
      const { progress_current, progress_done, progress_total, sections_count, evaluations_count } = info.lastRun;
      const pct = Math.min(100, Math.round((progress_done / progress_total) * 100));
      progressWrap.hidden = false;
      document.getElementById(`${k}ProgressBar`).style.width = pct + "%";
      const countLabel = kind === "schedule" ? `${sections_count} sections` : `${evaluations_count} new evaluations`;
      document.getElementById(`${k}ProgressLabel`).textContent =
        `${progress_done} / ${progress_total} — ${progress_current || ""} — ${countLabel} so far`;
    } else {
      progressWrap.hidden = true;
    }
  }
}

async function loadRuns() {
  const res = await adminFetch("/admin/api/scrape-runs");
  const { runs } = await res.json();
  const body = document.getElementById("runsBody");
  if (!runs.length) {
    body.innerHTML = '<tr><td colspan="7" class="empty">No runs yet.</td></tr>';
    return;
  }
  body.innerHTML = runs.map((r) => `
    <tr>
      <td>${r.kind}</td>
      <td>${r.trigger}</td>
      <td><span class="pill ${r.status}">${r.status}</span></td>
      <td>${fmtDate(r.started_at)}</td>
      <td>${r.sections_count ?? "—"}</td>
      <td>${r.evaluations_count ?? "—"}</td>
      <td style="max-width:280px">${r.summary ? escapeHtml(r.summary) : ""}</td>
    </tr>`).join("");
}

async function refresh() {
  await loadStatus();
  await loadRuns();
}

document.getElementById("rescrapeSchedBtn").onclick = async () => {
  const msg = document.getElementById("rescrapeSchedMsg");
  const res = await adminFetch("/admin/api/rescrape-schedule", { method: "POST" });
  const body = await res.json().catch(() => ({}));
  msg.textContent = res.status === 202 ? "Started." : (body.error || "Could not start.");
  await refresh();
};

document.getElementById("rescrapeEvalBtn").onclick = async () => {
  const msg = document.getElementById("rescrapeEvalMsg");
  const res = await adminFetch("/admin/api/rescrape-evaluations", { method: "POST" });
  const body = await res.json().catch(() => ({}));
  msg.textContent = res.status === 202 ? "Started -- this can take several hours the first time." : (body.error || "Could not start.");
  await refresh();
};

refresh();
setInterval(() => {
  for (const kind of ["schedule", "evaluations"]) {
    const k = kind === "schedule" ? "sched" : "eval";
    if (nextAutoRunAt[kind]) document.getElementById(`${k}Next`).textContent = fmtCountdown(nextAutoRunAt[kind]);
  }
}, 30000);
setInterval(refresh, 15000);

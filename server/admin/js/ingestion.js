const KINDS = {
  schedule: { prefix: "sched", btn: "rescrapeSchedBtn", msg: "rescrapeSchedMsg", label: "Rescrape schedule now", countField: "sections_count", countLabel: (n) => `${n} sections` },
  evaluations: { prefix: "eval", btn: "rescrapeEvalBtn", msg: "rescrapeEvalMsg", label: "Rescrape evaluations now", countField: "evaluations_count", countLabel: (n) => `${n} new evaluations` },
  rmp: { prefix: "rmp", btn: "rescrapeRmpBtn", msg: "rescrapeRmpMsg", label: "Rescrape RMP now", countField: "rmp_count", countLabel: (n) => `${n} reviews` },
  campusmap: { prefix: "campusmap", btn: "rescrapeCampusmapBtn", msg: "rescrapeCampusmapMsg", label: "Rescrape campus map now", countField: "campusmap_count", countLabel: (n) => `${n} locations` },
};
const nextAutoRunAt = { schedule: null, evaluations: null, rmp: null, campusmap: null };

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

async function loadStatus() {
  const res = await adminFetch("/admin/api/status");
  const data = await res.json();

  document.getElementById("deployedCommit").textContent = data.deployedCommit
    ? data.deployedCommit.slice(0, 12)
    : "N/A (not on Render, or var unset)";

  for (const [kind, cfg] of Object.entries(KINDS)) {
    const k = cfg.prefix;
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

    const btn = document.getElementById(cfg.btn);
    btn.disabled = info.running;
    btn.textContent = info.running ? "Running…" : cfg.label;

    const progressWrap = document.getElementById(`${k}Progress`);
    if (info.running && info.lastRun && info.lastRun.progress_total) {
      const { progress_current, progress_done, progress_total } = info.lastRun;
      const pct = Math.min(100, Math.round((progress_done / progress_total) * 100));
      progressWrap.hidden = false;
      document.getElementById(`${k}ProgressBar`).style.width = pct + "%";
      const countLabel = cfg.countLabel(info.lastRun[cfg.countField] ?? 0);
      document.getElementById(`${k}ProgressLabel`).textContent =
        `${progress_done} / ${progress_total} · ${progress_current || ""} · ${countLabel} so far`;
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
    body.innerHTML = '<tr><td colspan="9" class="empty">No runs yet.</td></tr>';
    return;
  }
  body.innerHTML = runs.map((r) => `
    <tr>
      <td>${r.kind}</td>
      <td>${r.trigger}</td>
      <td><span class="pill ${r.status}">${r.status}</span></td>
      <td>${fmtDate(r.started_at)}</td>
      <td>${r.sections_count ?? "N/A"}</td>
      <td>${r.evaluations_count ?? "N/A"}</td>
      <td>${r.rmp_count ?? "N/A"}</td>
      <td>${r.campusmap_count ?? "N/A"}</td>
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

document.getElementById("rescrapeRmpBtn").onclick = async () => {
  const msg = document.getElementById("rescrapeRmpMsg");
  const res = await adminFetch("/admin/api/rescrape-rmp", { method: "POST" });
  const body = await res.json().catch(() => ({}));
  msg.textContent = res.status === 202 ? "Started." : (body.error || "Could not start.");
  await refresh();
};

document.getElementById("rescrapeCampusmapBtn").onclick = async () => {
  const msg = document.getElementById("rescrapeCampusmapMsg");
  const res = await adminFetch("/admin/api/rescrape-campusmap", { method: "POST" });
  const body = await res.json().catch(() => ({}));
  msg.textContent = res.status === 202 ? "Started." : (body.error || "Could not start.");
  await refresh();
};

refresh();
setInterval(() => {
  for (const [kind, cfg] of Object.entries(KINDS)) {
    if (nextAutoRunAt[kind]) document.getElementById(`${cfg.prefix}Next`).textContent = fmtCountdown(nextAutoRunAt[kind]);
  }
}, 30000);
setInterval(refresh, 15000);

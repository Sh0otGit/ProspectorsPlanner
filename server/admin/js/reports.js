async function load() {
  const res = await adminFetch("/admin/api/reports");
  const { reports } = await res.json();
  const list = document.getElementById("reportsList");

  document.getElementById("statCount").textContent = reports.length;

  if (!reports.length) {
    list.innerHTML = '<div class="empty">No problem reports yet.</div>';
    return;
  }
  list.innerHTML = reports.map((r) => `
    <div class="review-card">
      <div class="meta">
        ${r.page ? escapeHtml(r.page) + " &middot; " : ""}${new Date(r.submitted_at).toLocaleString()}
        ${r.email ? " &middot; " + escapeHtml(r.email) : ""}
      </div>
      <div class="text">${escapeHtml(r.text)}</div>
    </div>`).join("");
}

load();

function stars(n) {
  return "★".repeat(n) + "☆".repeat(5 - n);
}

async function load() {
  const res = await adminFetch("/admin/api/reviews");
  const { reviews } = await res.json();
  const list = document.getElementById("reviewsList");

  document.getElementById("statCount").textContent = reviews.length;
  document.getElementById("statAvg").textContent = reviews.length
    ? (reviews.reduce((a, r) => a + r.rating, 0) / reviews.length).toFixed(2)
    : "—";
  document.getElementById("statWithText").textContent = reviews.filter((r) => r.text && r.text.trim()).length;

  if (!reviews.length) {
    list.innerHTML = '<div class="empty">No feedback submitted yet.</div>';
    return;
  }
  list.innerHTML = reviews.map((r) => `
    <div class="review-card">
      <div class="stars">${stars(r.rating)}</div>
      <div class="meta">${r.name ? escapeHtml(r.name) : "Anonymous"} &middot; ${new Date(r.submitted_at).toLocaleString()}</div>
      ${r.text ? `<div class="text">${escapeHtml(r.text)}</div>` : ""}
    </div>`).join("");
}

load();

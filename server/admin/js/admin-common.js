/* Masthead + nav were pasted into every admin page separately (ingestion,
   reviews, analytics), byte-identical apart from which nav link carries
   "on" -- same duplication problem the public site's masthead/footer had,
   fixed the same way: render it once from a body[data-admin-page] marker
   instead of copy-pasting the markup into a fourth file (reports.html). */
const ADMIN_NAV_ITEMS = [
  { page: "ingestion", label: "Ingestion" },
  { page: "reviews", label: "Reviews" },
  { page: "reports", label: "Reports" },
  { page: "analytics", label: "Analytics" },
];

function renderAdminChrome() {
  const header = document.getElementById("adminHeader");
  const nav = document.getElementById("adminNav");
  const current = document.body.dataset.adminPage;
  if (header) {
    header.innerHTML = `
<div class="masthead">
  <div class="wrap">
    <a class="lockup" href="/admin/ingestion.html">
      <span class="mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="#ff8200" stroke-width="2.6" stroke-linecap="square">
          <path d="M3 6h18"/><path d="M3 12h11"/><path d="M3 18h15"/>
        </svg>
      </span>
      <span class="words">
        <span class="n">Prospector's Planner</span>
        <span class="u">Admin</span>
      </span>
    </a>
    <span class="spacer"></span>
    <span class="tag">Internal</span>
  </div>
</div>`;
  }
  if (nav) {
    nav.innerHTML = `
${ADMIN_NAV_ITEMS.map(
  (item) => `<a href="/admin/${item.page}.html"${item.page === current ? ' class="on"' : ""}>${item.label}</a>`
).join("")}
<span class="spacer"></span>
<button id="logoutBtn">Log out</button>`;
  }
}
renderAdminChrome();

document.getElementById("logoutBtn")?.addEventListener("click", async () => {
  await fetch("/admin/api/logout", { method: "POST" });
  location.href = "/admin/login.html";
});

/* Every admin/api/* call funnels through here so a session that's expired
   mid-visit bounces back to the login page instead of showing a raw 401. */
async function adminFetch(url, options) {
  const res = await fetch(url, options);
  if (res.status === 401) {
    location.href = "/admin/login.html";
    throw new Error("Not authenticated");
  }
  return res;
}

/* Shared with reviews.js and ingestion.js -- loaded on every admin page
   before the page-specific script, same reason app.js's esc() lives in one
   place for the public site instead of every page redefining it. */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

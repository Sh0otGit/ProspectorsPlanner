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

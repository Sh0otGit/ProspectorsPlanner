/* Fixed-window per-IP limiter for public unauthenticated POST endpoints
   (reviews, problem reports). In-memory, not persisted -- resets on
   restart, which is fine for its actual job (blunting a burst of spam
   from one address), not a security boundary. */
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 5;

const hits = new Map(); // ip -> timestamps within the current window

export function isRateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > MAX_PER_WINDOW;
}

export function clientIp(req) {
  // Render (and most hosts) sit behind a proxy -- the real client address
  // is the first entry in X-Forwarded-For, not the socket's remote address.
  const fwd = req.headers["x-forwarded-for"];
  if (fwd) return fwd.split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}

// Sweep IPs with no hits in the last window so this doesn't grow forever
// under sustained traffic from many distinct addresses.
setInterval(() => {
  const now = Date.now();
  for (const [ip, times] of hits) {
    if (!times.some((t) => now - t < WINDOW_MS)) hits.delete(ip);
  }
}, 5 * 60_000).unref();

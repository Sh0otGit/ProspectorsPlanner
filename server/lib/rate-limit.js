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
  // Render (and most hosts) sit behind a proxy, so the socket's own remote
  // address is just that proxy, not the real visitor. X-Forwarded-For is
  // still attacker-controlled input, though: a client can set it directly on
  // its own request, and a reverse proxy conventionally *appends* its own
  // observed peer address as the last entry rather than replacing whatever
  // the client already sent -- confirmed the naive fix (trusting the first
  // entry) is spoofable: sending a different fake value on every request let
  // every single test request through the limiter below instead of only 5.
  // The last entry is the one the proxy itself added, which a client can't
  // control from outside it.
  const fwd = req.headers["x-forwarded-for"];
  if (fwd) {
    const hops = fwd.split(",").map((s) => s.trim()).filter(Boolean);
    if (hops.length) return hops[hops.length - 1];
  }
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

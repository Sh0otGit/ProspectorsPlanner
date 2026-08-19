/* Polite fetch: fixed delay between requests, descriptive User-Agent, no
   retries-hammering on failure. See CLAUDE.md, HB 2504 crawl path etiquette
   -- rate limit 1-2 req/s, identify the requester, cache aggressively. */
const DELAY_MS = 700; // ~1.4 req/s
const TIMEOUT_MS = 20000;
const USER_AGENT =
  process.env.SCRAPER_USER_AGENT ||
  "ProspectorsPlannerBot/0.1 (independent student project, contact: set SCRAPER_USER_AGENT env var with a real contact)";

let lastRequestAt = 0;

async function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/* An unrestricted query (see schedule.js) was found to hang indefinitely
   rather than error -- a bare `fetch` has no default timeout, so a bad
   request or a slow day on UTEP's end could otherwise stall a scrape run
   forever. */
export async function politeFetch(url, options = {}) {
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < DELAY_MS) await wait(DELAY_MS - elapsed);
  lastRequestAt = Date.now();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT, ...(options.headers || {}) },
    });
  } catch (e) {
    if (e.name === "AbortError") throw new Error(`Timed out after ${TIMEOUT_MS}ms: ${url}`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} for ${url}`);
  }
  return res.text();
}

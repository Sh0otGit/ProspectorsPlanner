/* Real building footprint polygons for the Map page's "highlight the
   whole building" treatment (see prototype/js/page-map.js), instead of
   just a pin at the building's point. Confirmed 2026-09-12 via a live
   query against a real UTEP building (Chemistry and Computer Science):
   a bounding box around a Concept3D point (see scrapers/campusmap.js)
   returns candidate OSM building ways with full ring geometry, and the
   one whose ring actually *contains* that point is the real match --
   point-in-polygon, not a name match, since OSM's own building name
   ("Chemistry and Computer Science") doesn't always agree with
   Concept3D's ("...Building") the way matchBuilding()'s own fuzzy text
   scoring needs. A point that falls inside no real building way keeps
   footprint = null rather than guessing the nearest candidate -- same
   "no data, not a wrong answer" rule matchBuilding() already applies.

   Overpass is a shared, volunteer-funded public service with its own
   fair-use policy (wiki.openstreetmap.org/wiki/Overpass_API), the same
   kind of "public, unauthenticated, but still someone else's
   infrastructure" call as Concept3D and RMP -- see CLAUDE.md's Data
   sources entry. Only locations still missing a footprint get queried
   at all (see scrapeBuildingFootprints in run.js) -- the same "cache
   aggressively, backfill once" instinct as HB 2504. Uses the flagship
   overpass-api.de instance, the canonical public endpoint.

   Does NOT reuse politeFetch's shared 700ms pacing: a real campus-wide
   run confirmed the hard way (2026-09-12, a live run against all 819
   non-parking locations) that Overpass needs much gentler treatment --
   `curl https://overpass-api.de/api/status` reports a public rate limit
   of just 2 concurrent slots shared across every user of the instance
   worldwide, and a batch of only 15 test requests at politeFetch's pace
   already drew 429s and 504s on more than half of them. That run
   reported "6 of 819 buildings matched" -- almost none of that gap was
   real OSM coverage (a genuine "no building way contains this point" is
   still fairly common for things Concept3D marks that aren't buildings
   at all, e.g. "Group Photo Location," "Parking entrance via..."), most
   of it was 429/504 responses getting caught by the same catch block as
   a real miss and silently recorded as one. overpassFetch() below paces
   requests much further apart and retries specifically on a 429/502/503/
   504 or a timeout before giving up on one building for this run --
   only a genuine successful response with no containing ring counts as
   "no footprint," matching this project's own rule that a failure isn't
   evidence of an answer. */
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const OVERPASS_DELAY_MS = 3000;
const RETRY_DELAYS_MS = [8000, 20000, 40000];
const TIMEOUT_MS = 30000; // a little past the query's own [timeout:25]
const USER_AGENT =
  process.env.SCRAPER_USER_AGENT ||
  "ProspectorsPlannerBot/0.1 (independent student project, contact: set SCRAPER_USER_AGENT env var with a real contact)";

// ~100m half-width at UTEP's latitude -- generous for one building's
// footprint plus room for Concept3D's point being a few meters off the
// true OSM centroid, without pulling in unrelated neighboring buildings.
const BBOX_DEG = 0.0009;

function buildQuery(lat, lng) {
  const minLat = lat - BBOX_DEG, maxLat = lat + BBOX_DEG;
  const minLng = lng - BBOX_DEG, maxLng = lng + BBOX_DEG;
  return `[out:json][timeout:25];way["building"]["building"!="roof"](${minLat},${minLng},${maxLat},${maxLng});out geom;`;
}

let lastRequestAt = 0;
// ponytail: a retryable-status check + linear backoff ladder, not a real
// rate-limiter library -- this scraper makes one kind of request to one
// host, so a generic client would be more code to prove correct for no
// real benefit. Upgrade if a second Overpass-backed scraper shows up.
async function overpassFetch(query) {
  for (let attempt = 0; ; attempt++) {
    const elapsed = Date.now() - lastRequestAt;
    if (elapsed < OVERPASS_DELAY_MS) await new Promise((r) => setTimeout(r, OVERPASS_DELAY_MS - elapsed));
    lastRequestAt = Date.now();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res, networkError = null;
    try {
      res = await fetch(OVERPASS_URL, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT },
        body: "data=" + encodeURIComponent(query),
      });
    } catch (e) {
      networkError = e.name === "AbortError" ? new Error(`Timed out after ${TIMEOUT_MS}ms`) : e;
    } finally {
      clearTimeout(timer);
    }

    const retryableStatus = res && [429, 502, 503, 504].includes(res.status);
    if ((networkError || retryableStatus) && attempt < RETRY_DELAYS_MS.length) {
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
      continue;
    }
    if (networkError) throw networkError;
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for Overpass`);
    return res.text();
  }
}

// Standard ray-casting point-in-polygon test. ring: [[lat,lng], ...].
function pointInRing(lat, lng, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i], [yj, xj] = ring[j];
    const crosses = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

// Shoelace formula -- picks the smallest (most specific) ring on the rare
// chance more than one candidate way contains the same point (overlapping
// wings, an inner courtyard structure).
function ringArea(ring) {
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    area += ring[j][1] * ring[i][0] - ring[i][1] * ring[j][0];
  }
  return Math.abs(area / 2);
}

/* One campus_locations point -> its real footprint ring, or null if a
   successful query found no real OSM building way containing it. Throws
   (rather than returning null) when every retry was exhausted without a
   real answer -- the caller treats that as "still missing, try again
   next scrape," not as "confirmed no footprint." */
export async function fetchBuildingFootprint(lat, lng) {
  const text = await overpassFetch(buildQuery(lat, lng));
  const { elements } = JSON.parse(text);
  let best = null, bestArea = Infinity;
  for (const el of elements) {
    if (!el.geometry) continue;
    const ring = el.geometry.map((p) => [p.lat, p.lon]);
    if (!pointInRing(lat, lng, ring)) continue;
    const area = ringArea(ring);
    if (area < bestArea) { best = ring; bestArea = area; }
  }
  return best;
}

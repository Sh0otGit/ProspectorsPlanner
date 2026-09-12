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
   sources entry. One bounding-box query per building, politeFetch's
   existing pacing between requests, and only locations still missing a
   footprint get queried at all (see scrapeBuildingFootprints in run.js)
   -- the same "cache aggressively, backfill once" instinct as HB 2504.
   Uses the flagship overpass-api.de instance, the canonical public
   endpoint. Confirmed live that response time on both this and the
   community kumi.systems mirror swings widely run to run (one attempt
   timed out on whichever instance had the heavier load at that moment,
   a retry on the other succeeded instantly) -- ordinary variance on a
   shared, best-effort service, not a reason to prefer one mirror over
   the other. A single building's request failing isn't fatal to a scrape
   run either way; see scrapeBuildingFootprints in run.js. */
import { politeFetch } from "./lib/fetch.js";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
// ~100m half-width at UTEP's latitude -- generous for one building's
// footprint plus room for Concept3D's point being a few meters off the
// true OSM centroid, without pulling in unrelated neighboring buildings.
const BBOX_DEG = 0.0009;

function buildQuery(lat, lng) {
  const minLat = lat - BBOX_DEG, maxLat = lat + BBOX_DEG;
  const minLng = lng - BBOX_DEG, maxLng = lng + BBOX_DEG;
  return `[out:json][timeout:25];way["building"]["building"!="roof"](${minLat},${minLng},${maxLat},${maxLng});out geom;`;
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

/* One campus_locations point -> its real footprint ring, or null if no
   real OSM building way contains it. */
export async function fetchBuildingFootprint(lat, lng) {
  const text = await politeFetch(OVERPASS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "data=" + encodeURIComponent(buildQuery(lat, lng)),
  });
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

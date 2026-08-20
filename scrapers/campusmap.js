/* Building/parking-lot locations for the Map page. UTEP's own campus map
   (utep.edu/map/) is an iframe of a third-party platform, Concept3D
   (map.concept3d.com/?id=843) -- confirmed 2026-08-21 via CDP network
   capture of the live page, the same technique already used to find RMP's
   GraphQL endpoint. Concept3D's data API is public and unauthenticated:
   the "key" query parameter is embedded directly in UTEP's own page JS
   (visible to any browser that loads utep.edu/map/, not a credential we
   obtained any other way), and returns every point on the map -- 929 of
   them -- as plain JSON with a name and exact lat/lng. This is Concept3D's
   platform, not UTEP's own published open data, so this is the same kind
   of deliberate, informed call as Rate My Professors (see rmp.js and
   CLAUDE.md's Data sources entry) rather than an assumption that it's
   fine to pull from.

   Coverage isn't restricted to Concept3D's own "Buildings" category tree
   (catId 21144) -- confirmed empirically against every room string this
   project has actually scraped: restricting to Buildings+Parking alone
   dropped real matches from 231/261 to 203/261, since useful room-level
   points (e.g. a specific building entrance) are sometimes filed under
   other categories like "Services." Instead, everything that isn't
   obviously non-physical (a dated event, a 360-degree virtual-tour
   "Interiors" entry, a dining menu) stays in the matching pool; only the
   Parking & Transportation subtree (catId 12786) is flagged is_parking
   for the Map page's optional parking layer -- see matchBuilding() in
   server/lib/campusmap.js for how a scraped room string actually
   resolves to one of these points. */
import { politeFetch } from "./lib/fetch.js";

const MAP_ID = "843";
// Not a secret -- see header comment. Embedded in UTEP's own public page.
const API_KEY = "0001085cc708b9cef47080f064612ca5";
const BASE = "https://api.concept3d.com";

export const BUILDINGS_ROOT_CAT = 21144;
export const PARKING_ROOT_CAT = 12786;

// Real, physical, evergreen locations only. Confirmed against the live
// data: everything this drops is either a dated one-off event ("Oct. 4 -
// Gold Nugget Reception"), a virtual-tour/floorplan duplicate of a real
// building ("Texas Western Hall - Interiors", "New Model for..."), or a
// dining menu/cafe listing that isn't itself a distinct location.
const JUNK_NAME_RE = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\.?\s|reception|breakfast|menu|-\s*interiors?$|^new model for|caf[ée]\b/i;

async function fetchJson(path) {
  const sep = path.includes("?") ? "&" : "?";
  const text = await politeFetch(`${BASE}${path}${sep}map=${MAP_ID}&key=${API_KEY}`);
  return JSON.parse(text);
}

// {catId: [catId, ...its own children]} for every category on the map --
// used to walk from the two root categories above down to every
// descendant, since Parking & Transportation itself has sub-categories
// (garages, individual lots) rather than every lot living directly under
// the root id.
async function fetchCategoryChildIds() {
  return fetchJson("/categories?childIds&noPrivates");
}

function descendants(childMap, rootId) {
  const seen = new Set();
  const stack = [rootId];
  while (stack.length) {
    const cur = stack.pop();
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const child of childMap[cur] || []) stack.push(child);
  }
  return seen;
}

/* Every non-junk point on the map, each tagged with whether it falls
   under Parking & Transportation. Not deduped by name here -- a building
   can legitimately have more than one point (different wings/entrances);
   matchBuilding() in server/lib/campusmap.js picks one at lookup time. */
export async function fetchCampusLocations() {
  const [locations, childMap] = await Promise.all([fetchJson("/locations"), fetchCategoryChildIds()]);
  const parkingIds = descendants(childMap, PARKING_ROOT_CAT);
  return locations
    .filter((l) => l.name && !JUNK_NAME_RE.test(l.name) && typeof l.lat === "number" && typeof l.lng === "number")
    .map((l) => ({ id: l.id, name: l.name, lat: l.lat, lng: l.lng, isParking: parkingIds.has(l.catId) }));
}

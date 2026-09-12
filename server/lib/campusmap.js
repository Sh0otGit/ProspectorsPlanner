/* Resolves a scraped room string ("Physical Science Building 322",
   "Texas Western Hall 203") to a real lat/lng from campus_locations (see
   scrapers/campusmap.js) for the Map page. A room string and a
   Concept3D location name are never identical -- Banner abbreviates
   ("Chemistry Computer Sci Bldg" for "Chemistry and Computer Science
   Building"), and a building can carry more than one point on the map
   (different wings/entrances share a name). Two-stage match, cheapest
   and most precise first:

   1. Exact prefix: does the room string start with a stored location's
      name? Longest name wins (so "Chemistry and Computer Science
      Building" doesn't lose to a shorter but also-prefix-matching name).
      Handles the common case where Banner's room string is literally
      "<building name> <room number>".
   2. Fuzzy token overlap, for when Banner's own name is a genuine
      abbreviation rather than a clean prefix. Common campus abbreviations
      (Bldg/Sci/Admin/...) are expanded before comparing -- tried relying
      on stem-matching alone first (any two tokens sharing a 6+ character
      prefix count as equal, e.g. geology/geological), but a short
      abbreviation like "Sci" or "Bldg" is too short to safely stem-match
      anything without risking a coincidental hit, and stripping them as
      "generic filler" instead broke precision the other way: a room
      string's own "Sci" then had nothing on the building-name side left
      to correspond to, since "Science" had been stripped from that side
      too. Scored in both directions -- how much of the *location name* is
      explained by the room string, and how much of the *room string* is
      explained by the location name -- and the weaker of the two has to
      clear the bar. One-directional scoring let a real false positive
      through during testing: "Texas Western Hall 203" scored well against
      "Texas Western Café" on the location-name side alone (2 of its 3
      words are a coincidence of two unrelated places sharing a prefix),
      but neither "café" nor "hall" corresponds to anything on the other
      side, which only shows up once precision is checked too.

      Confirmed against every distinct room string this project has
      actually scraped: 219 of 261 resolve this way, zero false positives
      (verified by hand against every fuzzy match, not just spot-checked).
      The remaining gap is mostly a handful of individually-unresolvable
      names ("Geology Building" vs. the source's "Geological Sciences
      Building" -- the room string has no word corresponding to
      "Sciences" at all, so precision can't clear the bar without a
      hardcoded override this project chose not to add for one building).
      A miss returns null, which the Map page renders as "no location on
      file for this room" -- the same "no data, not a wrong answer"
      pattern already used everywhere else in this project (an instructor
      with no evaluations, a course with no RMP match), not a guess.

      "Texas Western Hall" used to be in that gap too -- a real building,
      but Concept3D had no *clean* point for it, only two marked variants
      ("Texas Western Hall - Interiors", "New Model for Texas Western
      Hall") that scrapers/campusmap.js's own dedup filter dropped on the
      assumption a clean entry existed elsewhere, which turned out false
      for this one building (confirmed 2026-08-22 by a user report --
      Concept3D added these points once the building was completed, a
      little under a year old at the time, but never added a plain
      unmarked entry). Fixed at the source: that filter now only drops a
      marked variant when a clean point with the same core name survives
      elsewhere. displayName() below strips the marker text so a student
      sees "Texas Western Hall," not "Texas Western Hall - Interiors," on
      the map -- the raw name is still what's stored and matched against,
      only the label shown to a student is cleaned up. */
import { db } from "../../scrapers/lib/db.js";

// Expanded before comparing, not stripped -- a short abbreviation like
// "Sci" is too short to safely stem-match its full word (see header),
// so both sides need to already spell it the same way.
const ABBREVIATIONS = {
  bldg: "building", building: "building",
  sci: "science", science: "science", sciences: "science",
  admin: "administration", administration: "administration",
  ctr: "center", center: "center",
  dept: "department", department: "department",
  nurs: "nursing", nursing: "nursing",
  geology: "geological", geological: "geological",
};

function tokens(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => ABBREVIATIONS[t] || t);
}

function tokensEqual(a, b) {
  if (a === b) return true;
  if (a.length >= 6 && b.length >= 6 && a.slice(0, 6) === b.slice(0, 6)) return true;
  return false;
}

/* Words too short/common to mean anything on their own ("of," "the," a
   bare room number) -- excluded from both the numerator and denominator
   on both sides, rather than required to match, so they can't drag a
   real match down (a room string's leading "The") or coincidentally
   inflate one (two unrelated names both containing "of"). Real content
   words stay in play at their full length; nothing gets expanded away
   entirely the way the old generic-word list did. */
function meaningful(tok) {
  return tok.length >= 4 && !/^\d+$/.test(tok);
}

function fuzzyScore(roomTokens, locationName) {
  const nameTokens = tokens(locationName).filter(meaningful);
  const roomWords = roomTokens.filter(meaningful);
  if (!nameTokens.length || !roomWords.length) return 0;
  const buildingHits = nameTokens.filter((nt) => roomWords.some((rt) => tokensEqual(rt, nt))).length;
  const roomHits = roomWords.filter((rt) => nameTokens.some((nt) => tokensEqual(rt, nt))).length;
  return Math.min(buildingHits / nameTokens.length, roomHits / roomWords.length);
}

const FUZZY_THRESHOLD = 0.7;

// Same marker patterns scrapers/campusmap.js uses to decide whether to keep
// a "X - Interiors"/"New Model for X" point at all -- here they're stripped
// for display once a match is found, so a student sees the building's real
// name, not Concept3D's internal variant label.
const DUPLICATE_SUFFIX_RE = /\s*-\s*interiors?$/i;
const DUPLICATE_PREFIX_RE = /^new model for\s+/i;
function displayName(name) {
  return name.replace(DUPLICATE_SUFFIX_RE, "").replace(DUPLICATE_PREFIX_RE, "").trim();
}

// building_footprints stores a JSON [[lat,lng], ...] ring per location id
// that actually resolved to a real OSM building way (see
// scrapers/buildingfootprints.js) -- a location with no row there just has
// no footprint on file, parsed here as null rather than guessed.
function parseFootprint(json) {
  if (!json) return null;
  try { return JSON.parse(json); } catch { return null; }
}

/* locations: [{id, name, lat, lng, isParking, footprintJson}], typically
   every row from allLocations() below. Returns {id, name, lat, lng,
   footprint} or null. */
export function matchBuilding(room, locations) {
  if (!room) return null;
  const roomLower = room.toLowerCase();

  let best = null, bestLen = 0;
  for (const loc of locations) {
    const nameLower = loc.name.toLowerCase();
    if (roomLower.startsWith(nameLower) && nameLower.length > bestLen) {
      best = loc;
      bestLen = nameLower.length;
    }
  }
  if (best) return { id: best.id, name: displayName(best.name), lat: best.lat, lng: best.lng, footprint: parseFootprint(best.footprintJson) };

  const roomTokens = tokens(room);
  let bestScore = 0, bestLoc = null;
  for (const loc of locations) {
    const score = fuzzyScore(roomTokens, loc.name);
    if (score > bestScore) {
      bestScore = score;
      bestLoc = loc;
    }
  }
  if (bestLoc && bestScore >= FUZZY_THRESHOLD) {
    return { id: bestLoc.id, name: displayName(bestLoc.name), lat: bestLoc.lat, lng: bestLoc.lng, footprint: parseFootprint(bestLoc.footprintJson) };
  }
  return null;
}

/* Rebuilt per call, same tradeoff as catalog.js's instructorIndex() --
   campus_locations only changes on a scrape (every ~120 days) and is
   under 1,000 rows, cheap enough that a stale cache surviving a live
   rescrape isn't worth the risk. Callers matching more than one room
   (catalog.js's getCourse(), matching every section in one course) should
   call this once and reuse it with matchBuilding() directly rather than
   re-querying per room. LEFT JOIN, not a second query per location -- a
   location with no footprint scraped yet (or ever, if it's a parking lot)
   just comes back with footprintJson null. */
export function allLocations() {
  return db
    .prepare(
      `SELECT c.id, c.name, c.lat, c.lng, c.is_parking AS isParking, f.polygon AS footprintJson
       FROM campus_locations c
       LEFT JOIN building_footprints f ON f.location_id = c.id`
    )
    .all();
}

/* Every parking-lot point, for the Map page's optional parking layer --
   not filtered to "near your classes," since there are only ~70 lots
   campus-wide and the whole point of showing them is orienting relative
   to wherever a student's buildings turn out to be. */
export function listParkingLocations() {
  return db.prepare(`SELECT id, name, lat, lng FROM campus_locations WHERE is_parking = 1`).all();
}

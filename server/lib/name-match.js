/* Shared by server/lib/catalog.js (Banner "First Last" <-> HB 2504 "Last,
   First[ Middle initial]") and the RMP matching step in scrapers/rmp.js
   (Banner "First Last" <-> RMP's separate firstName/lastName fields) --
   the same underlying problem twice: two independently-sourced name
   strings for the same person, different order, no shared ID, sometimes
   an extra middle initial one side carries and the other doesn't.

   Matches on the *set* of name words: Banner's "Vladik Kreinovich"
   ({vladik,kreinovich}) has to match HB 2504's "Kreinovich, Vladik Y."
   ({kreinovich,vladik,y}) even though the second set has an extra token --
   confirmed a real, common case, not a hypothetical -- so this matches
   when either side's word set is fully contained in the other's, not only
   on exact equality. A miss just means "no data" for that source, the
   same state already shown for a brand new hire -- not a new failure
   mode, just fewer instructors that get the extra signal. */

export function nameTokenSet(raw) {
  return new Set(
    (raw || "")
      .replace(/\([^)]*\)/g, " ")
      .replace(/[^a-zA-Z\s'-]/g, " ")
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
  );
}

export function isSubset(smaller, larger) {
  for (const t of smaller) if (!larger.has(t)) return false;
  return true;
}

export function cleanBannerName(raw) {
  return (raw || "").replace(/\s*\([^)]*\)\s*$/, "").trim();
}

/* index: [{ tokens: Set, row }]. Prefers an exact word-set match when one
   exists, so a subset match elsewhere in a directory of a couple thousand
   people can't outrank the real one. */
export function findByName(index, name) {
  const nameTokens = nameTokenSet(name);
  if (!nameTokens.size) return null;
  let subsetMatch = null;
  for (const { tokens, row } of index) {
    if (tokens.size === nameTokens.size && isSubset(nameTokens, tokens)) return row;
    if (!subsetMatch && (isSubset(nameTokens, tokens) || isSubset(tokens, nameTokens))) subsetMatch = row;
  }
  return subsetMatch;
}

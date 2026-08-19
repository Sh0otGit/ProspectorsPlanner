/* Every scraper here pulls text straight out of raw HTML with a regex,
   never through a real HTML parser, so none of it comes back with entities
   decoded -- confirmed a real bug, not theoretical: the HB 2504 directory's
   own department text uses "&#x27;" for an apostrophe ("Women's and Gender
   Studies"), and it was landing in the database, and on screen, as the
   literal six characters "&#x27;" instead of "'". Anywhere scraped text
   becomes a stored field needs this before it's stored, not just this one
   department string -- course titles, room names and instructor names can
   all plausibly carry an apostrophe, an ampersand, or a quote. */
const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(str) {
  if (!str) return str;
  return str.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/gi, (match, ent) => {
    if (ent[0] === "#") {
      const code = ent[1].toLowerCase() === "x" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ent.toLowerCase() in NAMED ? NAMED[ent.toLowerCase()] : match;
  });
}

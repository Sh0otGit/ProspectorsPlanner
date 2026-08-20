/* =====================================================================
   SHARED: state, formatting utilities, scoring, and the chrome
   (progress nav, breadcrumbs, action bar) rendered on every step page.

   State lives in sessionStorage, not localStorage: it is scoped to
   the tab and clears on close. Only the student's own choices (picked
   courses, blocked hours, added sections) are stored here.
   ===================================================================== */

/* Scoring config -- see CLAUDE.md, "Scoring." The shrinkage constants
   (university mean, prior weight) are applied server-side now (see
   server/lib/catalog.js), since that's where the real evaluation rows
   live; only the eval/RMP blend weight is still needed here. */
const W_EVAL = 0.5, W_RMP = 0.5;
const DIST_KEYS = ["Excellent","Good","Satisfactory","Poor","Very Poor"];
const REVIEWS_PER_PAGE = 3;

const SCREENS = ["index.html","courses.html","availability.html","instructors.html","schedule.html"];
// Ten distinct colors, not five -- a student can have more picks than
// that once a course with a required lab/seminar counts as two (see
// server/lib/catalog.js's components), and reusing a color after five
// made two genuinely unrelated classes look like the same one at a
// glance. None of these are red; see the --series-3.. definitions in
// styles.css for why. Shared between page-schedule.js and page-map.js so
// a course reads as the same color on both pages.
const PALETTE = ["--series-1","--series-2","--r4","--star","--r5","--series-3","--series-4","--series-5","--series-6","--series-7"];
const STEP_LABELS = ["Start","Courses","Availability","Instructors","Schedule"];
const DAYS = ["M","T","W","R","F","S"];
const DAY_NAMES = {M:"Mon",T:"Tue",W:"Wed",R:"Thu",F:"Fri",S:"Sat"};
const START_H = 6, END_H = 21, SLOT_MIN = 30;
const SS_KEY = "prospectors_planner_ui_state_v1";

const $  = (s,r=document)=>r.querySelector(s);
const $$ = (s,r=document)=>[...r.querySelectorAll(s)];

/* ---------- escaping ----------
   Real scraped names, titles, rooms and course descriptions flow through
   these innerHTML templates now (see CATALOG below) -- escape any string
   that could plausibly come from outside this file. */
function esc(s){
  return String(s).replace(/[&<>"']/g, c => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  }[c]));
}

/* ---------- state ----------
   state.chosen: Map<courseCode, Map<scheduleType, {profName, crn}>>.
   A course can have more than one required, separately-timed component
   (a lecture plus its own seminar/recitation under the same course
   number, e.g. PHYS 2320's Lecture and Seminar sections) -- one active
   pick per distinct schedule_type, not one pick per course, is what
   actually matches how UTEP structures those courses. See
   server/lib/catalog.js's `components` field, which is what tells the
   UI a course has more than one such slot to fill. */
function loadState(){
  let d = {};
  try { d = JSON.parse(sessionStorage.getItem(SS_KEY)) || {}; } catch(e){}
  const chosen = new Map();
  for(const [code, byType] of Object.entries(d.chosen || {})){
    if(byType && typeof byType === "object") chosen.set(code, new Map(Object.entries(byType)));
  }
  return {
    picked: new Set(d.picked || []),
    blocked: new Set(d.blocked || []),
    chosen,
    activeCourse: d.activeCourse || null,
    visited: new Set(d.visited && d.visited.length ? d.visited : [0]),
    revOpen: new Set(d.revOpen || []),
    revPage: d.revPage || {}
  };
}
function saveState(){
  const chosen = {};
  for(const [code, byType] of state.chosen) chosen[code] = Object.fromEntries(byType);
  sessionStorage.setItem(SS_KEY, JSON.stringify({
    picked: [...state.picked],
    blocked: [...state.blocked],
    chosen,
    activeCourse: state.activeCourse,
    visited: [...state.visited],
    revOpen: [...state.revOpen],
    revPage: state.revPage
  }));
}
const state = loadState();

/* ---------- real course data ----------
   Replaces the old prototype/js/data.js fabricated CATALOG. Course codes
   in state.picked are only ever added from a real search against
   /api/courses (see page-courses.js), so unlike the old CATALOG[c] check,
   activeCodes() doesn't need to verify a code is "real" -- it already is,
   by construction. That matters because CATALOG itself is now populated
   asynchronously (a fetch, not a synchronous object literal), and the
   chrome/nav rendering that activeCodes() feeds runs on every page load,
   before any fetch could have resolved -- gating it on CATALOG would have
   made every step indicator flicker "locked" until the network caught up. */
/* Persisted to sessionStorage (same tab-scoped lifetime as `state` above)
   so switching between step pages -- each a full navigation, not a SPA
   route -- doesn't refetch a course's professors/sections from
   /api/course every time. Without this, instructors.html and
   schedule.html each re-fetch every picked course from scratch on every
   visit, which is the network-bound "reload" a student sees clicking
   back and forth between those two tabs. Data only changes on a scrape
   (daily at the very fastest, see CLAUDE.md), far slower than a single
   browsing session, so there's no staleness concern within one tab's
   lifetime -- and it clears on tab close exactly like the rest of
   `state`, so a returning visitor still gets fresh data. */
const CATALOG_CACHE_KEY = "prospectors_planner_catalog_v1";
const CATALOG = {};
const CATALOG_TITLE = {};
// code -> {requiresLab: {subject,courseNumber,title}|null, components: string[]}
// See server/lib/catalog.js for how these are derived.
const CATALOG_META = {};
let TERM_LABEL = null;
(function loadCatalogCache(){
  try {
    const d = JSON.parse(sessionStorage.getItem(CATALOG_CACHE_KEY)) || {};
    Object.assign(CATALOG, d.courses || {});
    Object.assign(CATALOG_TITLE, d.titles || {});
    Object.assign(CATALOG_META, d.meta || {});
    if(d.term) TERM_LABEL = d.term;
  } catch(e){}
})();
function saveCatalogCache(){
  sessionStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify({
    courses: CATALOG, titles: CATALOG_TITLE, meta: CATALOG_META, term: TERM_LABEL
  }));
}
async function ensureCatalog(codes){
  const missing = [...new Set(codes)].filter(c=>!CATALOG[c]);
  if(!missing.length) return;
  const results = await Promise.all(missing.map(c =>
    fetch("/api/course?code="+encodeURIComponent(c)).then(r=>r.json())
  ));
  missing.forEach((c,i)=>{
    CATALOG[c] = results[i].professors;
    CATALOG_TITLE[c] = results[i].title;
    CATALOG_META[c] = { requiresLab: results[i].requiresLab || null, components: results[i].components || [] };
    if(results[i].term) TERM_LABEL = results[i].term;
  });
  saveCatalogCache();
}

async function ensureTerm(){
  if(TERM_LABEL) return TERM_LABEL;
  const r = await fetch("/api/term").then(r=>r.json());
  TERM_LABEL = r.termLabel || "the current term";
  saveCatalogCache();
  return TERM_LABEL;
}

/* Every {scheduleType, profName, crn} currently chosen for one course --
   usually zero or one, occasionally two (a lecture and its seminar). */
function chosenEntries(code){
  const byType = state.chosen.get(code);
  if(!byType) return [];
  return [...byType].map(([scheduleType,v])=>({scheduleType, profName:v.profName, crn:v.crn}));
}

/* Resolves one chosen entry's live section object from CATALOG rather
   than storing it, so the fetched data stays the single source. Returns
   null (not a throw) if that course hasn't been fetched into CATALOG yet
   on this page -- callers that need it are expected to await
   ensureCatalog() first. */
function resolveSection(code, entry){
  const p = (CATALOG[code]||[]).find(x=>x.name===entry.profName);
  return p ? p.sections.find(s=>s.crn===entry.crn) : null;
}

/* Back-compat convenience for the common case (a course with only one
   chosen component) -- the first resolved section, or null. Schedule/
   calendar code that needs *every* chosen section (a course can have
   more than one now) uses allChosenSections() below instead. */
function getChosenSection(code){
  for(const entry of chosenEntries(code)){
    const sec = resolveSection(code, entry);
    if(sec) return sec;
  }
  return null;
}

/* Every {code, entry, sec} currently chosen, across every picked course --
   flattened because a single course can now contribute more than one
   section (a lecture and its seminar are two separate calendar entries,
   two separate CRNs), so "one pick per course" no longer holds. */
function allChosenSections(){
  const out = [];
  for(const code of state.picked){
    for(const entry of chosenEntries(code)){
      const sec = resolveSection(code, entry);
      if(sec) out.push({code, entry, sec});
    }
  }
  return out;
}

/* Start, Courses and Availability are always reachable. Instructors and
   Schedule additionally need at least one selected course. */
function activeCodes(){ return [...state.picked]; }
function stepReachable(i){
  if(i<=2) return true;
  return activeCodes().length>0;
}

/* ---------- formatting ---------- */
const SLOTS = (()=>{ const o=[]; for(let m=START_H*60;m<END_H*60;m+=SLOT_MIN) o.push(m); return o; })();
const toMin = t => t ? (+t.slice(0,2))*60 + (+t.slice(3,5)) : null;
/* Style guide: no excess zeros ("9 a.m."), lowercase a.m./p.m.,
   and "noon"/"midnight" instead of 12 p.m. / 12 a.m. */
const fmt = t => {
  if(!t) return "";
  const H=+t.slice(0,2), m=t.slice(3,5);
  if(H===12 && m==="00") return "noon";
  if(H===0  && m==="00") return "midnight";
  const ap = H>=12 ? "p.m." : "a.m.";
  const h = H%12 || 12;
  return (m==="00" ? String(h) : h+":"+m) + " " + ap;
};

// "Lecture (LECT)" -> "Lecture" -- Banner's own schedule-type code in
// parentheses isn't something a student needs to see in plain-English
// UI text (a companion-section disclaimer, a calendar legend entry).
function shortType(scheduleType){
  return (scheduleType||"").replace(/\s*\([^)]*\)\s*$/,"").trim();
}

/* Style guide: spell out one through nine, numerals for 10 and up. */
const NUMWORD=["zero","one","two","three","four","five","six","seven","eight","nine"];
const num    = n => n<10 ? NUMWORD[n] : String(n);
const numCap = n => { const w=num(n); return w[0].toUpperCase()+w.slice(1); };
const slotIdx = min => Math.floor((min - START_H*60)/SLOT_MIN);

function sectionSlots(sec){
  if(!sec.days.length || sec.start==null) return [];
  const a=slotIdx(toMin(sec.start)), b=Math.ceil((toMin(sec.end)-START_H*60)/SLOT_MIN);
  const out=[];
  for(const d of sec.days) for(let i=a;i<b;i++) out.push(d+"-"+i);
  return out;
}
const hitsBlocked = sec => sectionSlots(sec).some(k=>state.blocked.has(k));

/* Codes of other added sections whose time overlaps this one's -- lets
   the UI name which course conflicts, not just whether one does.
   exceptScheduleType excludes this exact chosen entry (not just its
   course) from matching itself, since a course can now have more than
   one chosen section -- without it, checking a course's own already-
   added lecture against its own already-added seminar would always
   "conflict with itself" the moment both were picked. A real overlap
   between a course's own lecture and its own seminar is still reported
   (it'll just name that same course code), which is correct: they do
   conflict, the UI just can't tell you "with itself" more specifically
   than that. */
function conflictingCodes(sec, exceptCode, exceptScheduleType){
  const mine = new Set(sectionSlots(sec));
  const out = [];
  for(const {code, entry, sec:otherSec} of allChosenSections()){
    if(code===exceptCode && entry.scheduleType===exceptScheduleType) continue;
    if(sectionSlots(otherSec).some(k=>mine.has(k))) out.push(code);
  }
  return out;
}

/* Total conflict/blocked-hour issues across every section chosen for
   this course (not just one, now that a course can have several). */
function conflictCount(code){
  let n = 0;
  for(const entry of chosenEntries(code)){
    const sec = resolveSection(code, entry);
    if(!sec) continue;
    n += conflictingCodes(sec, code, entry.scheduleType).length + (hitsBlocked(sec)?1:0);
  }
  return n;
}

function combined(p){
  const hasE = p.evalAdj!=null, hasR = !!p.rmp;
  if(!hasE && !hasR) return null;
  if(!hasE) return p.rmp.score;
  if(!hasR) return p.evalAdj;
  return W_EVAL*p.evalAdj + W_RMP*p.rmp.score;
}
function starsHTML(v){
  const pct = v==null ? 0 : Math.max(0,Math.min(100, v/5*100));
  return '<span class="starwrap" role="img" aria-label="'+(v==null?"no rating":v.toFixed(2)+" out of 5")+'">'
       + '<span class="starbase">&#9733;&#9733;&#9733;&#9733;&#9733;</span>'
       + '<span class="starfill" style="width:'+pct+'%">&#9733;&#9733;&#9733;&#9733;&#9733;</span></span>';
}
const qColor = q => "var(--r"+Math.max(1,Math.min(5,q))+")";

/* Real slots start at START_H (6 a.m.) so the two half-hours before 7 a.m.
   are genuine, clickable slots, not dead space. Their hour label is just
   suppressed below LABEL_FROM_H so the grid still reads as starting at
   7 a.m., matching the buffer that already exists below the last labeled
   hour (the hour label is nudged up 7px to align with its gridline; a
   labeled first row would poke that nudge past the table's top border). */
const LABEL_FROM_H = 7;
function calSkeleton(id, cellFn){
  let h = "<thead><tr><th><span class=\"sr-only\">Time</span></th>" + DAYS.map(d=>'<th data-day="'+d+'">'+DAY_NAMES[d]+"</th>").join("") + "</tr></thead><tbody>";
  SLOTS.forEach((m,i)=>{
    const label = (m%60===0 && m>=LABEL_FROM_H*60) ? fmt(String(Math.floor(m/60)).padStart(2,"0")+":00") : "";
    h += '<tr><td class="t">'+label+"</td>" + DAYS.map(d=>cellFn(d,i)).join("") + "</tr>";
  });
  $(id).innerHTML = h + "</tbody>";
}

/* ---------- chrome: progress nav, breadcrumbs, action bar ----------
   Each step page sets window.CURRENT_STEP (1 to 5) before this script
   runs. Landing (index.html) leaves it unset and carries no chrome. */
function renderChrome(){
  const n = window.CURRENT_STEP;
  if(n==null) return;

  state.visited.add(n);
  saveState();

  $("#sectionnavInner").innerHTML = STEP_LABELS.map((l,i)=>{
    let cls;
    if(i===n)                     cls = "item active";
    else if(!stepReachable(i))    cls = "item locked";
    else if(state.visited.has(i)) cls = "item done";
    else                          cls = "item avail";
    /* Start (i===0) isn't part of the numbered 1-4 sequence used in the
       "Step X of 4" copy on each page, so its badge stays blank. */
    const mark = i===0 ? "" : i;
    return '<button class="'+cls+'" data-step="'+i+'"'+(cls==="item locked"?" disabled":"")
         + '><span class="n">'+mark+'</span>'+l+'</button>';
  }).join("")
  // Map isn't part of the numbered 1-4 flow (see CLAUDE.md -- that count
  // is settled elsewhere in this file's own step logic) -- it's an
  // always-reachable utility view, same idea as Start, just appended
  // after Schedule instead of before Courses. No lock state: it renders
  // its own empty state fine with nothing picked yet.
  + '<button class="item '+(n==="map"?"active":"avail")+'" data-map-link><span class="n"></span>Map</button>';
  $$(".item.done[data-step],.item.avail[data-step]").forEach(el=>el.onclick=()=>{ location.href = SCREENS[+el.dataset.step]; });
  const mapLink = $("[data-map-link]");
  if(mapLink) mapLink.onclick = () => { location.href = "map.html"; };

  /* No fixed bottom bar -- each page places its own Back/Skip/Continue
     inline wherever makes sense for that page's layout (courses and
     availability under their main panel, instructors under the Your
     Courses tab, schedule under the calendar). Every lookup here is
     optional: a page that doesn't have a given control just skips
     wiring it instead of erroring on a missing element. */
  const back=$("#backBtn"), skip=$("#skipBtn"), next=$("#nextBtn"), hint=$("#navHint");

  if(back){
    back.style.visibility = n<=0 ? "hidden" : "visible";
    back.onclick = ()=>{ location.href = SCREENS[n-1]; };
  }
  if(skip){
    skip.style.display = n===2 ? "" : "none";
    skip.onclick = ()=>{ location.href = SCREENS[3]; };
  }
  if(next){
    next.onclick = ()=>{ location.href = SCREENS[n+1]; };
  }

  if(n===1){
    const c=state.picked.size;
    if(next){ next.disabled=c===0; next.textContent="Continue"; }
    if(hint) hint.textContent = c ? numCap(c)+" course"+(c>1?"s":"")+" selected" : "Select at least one course";
  } else if(n===2){
    if(next){ next.disabled=false; next.textContent="Continue"; }
    if(hint) hint.textContent = state.blocked.size ? numCap(state.blocked.size)+" half-hour blocks marked" : "No hours blocked";
  } else if(n===3){
    const c=state.chosen.size;
    if(next){ next.disabled=c===0; next.textContent="View schedule"; }
  } else if(hint){
    hint.textContent = "";
  }
}

/* ---------- shared chrome: utility bar, masthead, footer ----------
   Byte-identical across all six pages (verified via hash before this
   change existed) but was pasted into every file separately, so any
   nav/footer edit meant six manual edits. Injected here instead, the
   same way the section-nav's *contents* already were -- only the
   outer <nav> shell stayed static markup because it's the same
   zero-flash pattern already proven out in this codebase. */
const SITE_HEADER_HTML = `
<a class="skiplink" href="#main">Skip to content</a>
<div class="utility">
  <div class="wrap">
    <span class="unaff">Not affiliated with or endorsed by The University of Texas at El Paso</span>
  </div>
</div>

<div class="masthead">
  <div class="wrap">
    <a class="lockup" href="index.html">
      <span class="mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="#ff8200" stroke-width="2.6" stroke-linecap="square">
          <path d="M3 6h18"/><path d="M3 12h11"/><path d="M3 18h15"/>
        </svg>
      </span>
      <span class="words">
        <span class="n">Prospector's Planner</span>
        <span class="u">Course planning for UTEP students</span>
      </span>
    </a>
    <span class="spacer"></span>
    <span class="tag">Real UTEP course data</span>
  </div>
</div>`;

const SITE_FOOTER_HTML = `
  <div class="wrap">
    <div class="footcols">
      <div>
        <h2>Prospector's Planner</h2>
        <ul>
          <li>An independent student project</li>
          <li>El Paso, Texas</li>
          <li><a href="https://github.com/Sh0otGit/ProspectorsPlanner" target="_blank" rel="noopener">Source code</a></li>
        </ul>
      </div>
      <div>
        <h2>UTEP links</h2>
        <ul>
          <li><a href="https://goldmine9.utep.edu/" target="_blank" rel="noopener">Goldmine</a></li>
          <li><a href="#" class="stublink">Registration dates</a></li>
          <li><a href="#" class="stublink">Add and drop</a></li>
          <li><a href="#" class="stublink">Academic calendar</a></li>
        </ul>
      </div>
      <div>
        <h2>Data sources</h2>
        <ul>
          <li><a href="#" class="stublink">HB 2504 faculty profiles</a></li>
          <li><a href="#" class="stublink">Class schedule search</a></li>
          <li><a href="#" class="stublink">Course catalog</a></li>
        </ul>
      </div>
      <div>
        <h2>About Prospector's Planner</h2>
        <ul>
          <li><a href="methodology.html">Methodology</a></li>
          <li><a href="privacy.html">Privacy</a></li>
          <li><a href="terms.html">Terms of use</a></li>
          <li><a href="accessibility.html">Accessibility</a></li>
          <li><a href="report.html">Report a problem</a></li>
        </ul>
      </div>
    </div>
    <div class="footrule">
      <b style="color:#fff">Prospector's Planner is an independent student project.</b> It is not affiliated with,
      sponsored by or endorsed by The University of Texas at El Paso. No UTEP logo, wordmark, pick,
      boxmark, seal or mascot is used. UTEP is referenced only to describe which students the tool
      serves. Instructor, evaluation and schedule data is real, scraped from public UTEP sources
      -- see <a href="methodology.html" style="color:#ffb257">Methodology</a>.
    </div>
  </div>`;

function renderSiteChrome(){
  const h = $("#siteHeader"), f = $("#siteFooter");
  if(h) h.innerHTML = SITE_HEADER_HTML;
  if(f){
    f.innerHTML = SITE_FOOTER_HTML;
    // Footer links for data sources this project describes but doesn't yet
    // link out to individually. Bound here instead of inline onclick=""
    // attributes so the CSP's script-src doesn't need 'unsafe-inline'.
    $$(".stublink",f).forEach(a=>a.onclick=e=>e.preventDefault());
  }
}
renderSiteChrome();

/* ---------- cookie / storage notice ----------
   Not built to satisfy an ad-tech consent framework -- there are no
   tracking or advertising cookies here to consent to. It exists so a
   first-time visitor isn't left guessing what "session data" on the
   Privacy page actually means: this site's own session storage, plus the
   one HttpOnly cookie the admin panel sets for the operator, never for a
   student using the planner. Dismissal is remembered in localStorage
   (not sessionStorage) so it doesn't reappear every time a returning
   visitor opens a new tab. */
const COOKIE_ACK_KEY = "prospectors_planner_cookie_ack";
function renderCookieBanner(){
  if(localStorage.getItem(COOKIE_ACK_KEY)) return;
  const el = document.createElement("div");
  el.className = "cookiebanner";
  el.innerHTML =
    '<div class="wrap">'
    + '<p>This site stores your in-progress picks in your browser\'s session storage, cleared when '
    + 'you close the tab. No tracking or advertising cookies. The admin panel sets one cookie for '
    + 'the site operator only. See <a href="privacy.html">Privacy</a>.</p>'
    + '<button class="btn sm primary" id="cookieAckBtn">Got it</button>'
    + '</div>';
  document.body.appendChild(el);
  $("#cookieAckBtn").onclick = () => {
    localStorage.setItem(COOKIE_ACK_KEY, "1");
    el.remove();
  };
}
renderCookieBanner();

renderChrome();

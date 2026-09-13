/* =====================================================================
   STEP 2: search real UTEP course offerings and pick which ones you
   still need. Replaces the old fixed personalized requirement list --
   there's no real substitute for that yet (it needs the degree
   evaluation parser, deliberately last in the build order, see
   CLAUDE.md) -- with a search against every course actually offered
   this term, from /api/courses.
   ===================================================================== */
let ALL_COURSES = [];
// Every term actually scraped (see ensureTerms() in app.js), populated
// once at init -- for the Term stat tile's dropdown. Just the one term
// today, but the dropdown always renders as a real <select>, not a
// plain label, so it's already the control it needs to be once a
// second term shows up here.
let TERM_OPTIONS = [];

function courseRow(code, title, selected){
  return '<div class="crnrow"><div class="crntop"><span><b>'+esc(code)+'</b><br>'
    + '<span style="color:var(--ink-muted);font-size:11.5px">'+esc(title||"")+'</span></span>'
    + '<button class="btn xs '+(selected?"":"blue")+'" data-toggle="'+esc(code)+'">'+(selected?"Remove":"Add")+'</button></div></div>';
}

function renderStats(){
  $("#statbar").style.gridTemplateColumns = "repeat(3,1fr)"; // this page has 3 stats, not the usual 4
  const termHTML = TERM_OPTIONS.length
    ? '<select class="termselect" id="termSelect" aria-label="Term">'
      + TERM_OPTIONS.map(t=>'<option value="'+esc(t.termCode)+'"'+(t.termCode===state.termCode?" selected":"")+'>'+esc(t.termLabel)+'</option>').join("")
      + '</select>'
    : esc(TERM_LABEL||"N/A");
  $("#statbar").innerHTML =
    '<div><div class="lab">Term</div><div class="val" style="font-size:18px">'+termHTML+'</div></div>'
  + '<div><div class="lab">Courses offered</div><div class="val">'+ALL_COURSES.length+'</div><div class="sub">this term</div></div>'
  + '<div><div class="lab">Selected</div><div class="val">'+state.picked.size+'</div><div class="sub">course'+(state.picked.size===1?"":"s")+'</div></div>';
  const sel = $("#termSelect");
  if(sel) sel.onchange = () => loadForTerm(sel.value);
}

function renderSelected(){
  const codes = [...state.picked];
  const box = $("#selectedPanel");
  if(!codes.length){
    box.innerHTML = '<div class="phead">Selected courses</div><div class="pad"><div class="empty">No courses selected yet. Search above.</div></div>';
    return;
  }
  box.innerHTML = '<div class="phead">Selected courses ('+codes.length+')</div><div class="pad">'
    + codes.map(c=>{
        const course = ALL_COURSES.find(x=>x.code===c);
        return courseRow(c, course?course.title:"", true);
      }).join("")
    + '</div>';
  wireToggles();
}

/* Code matches outrank title matches -- typing "cs" used to surface every
   course whose TITLE happens to contain that substring (Economics,
   Physics, Forensics...) ahead of actual CS courses, since the old
   filter matched "code + title" as one blob with no ranking at all and
   subjects alphabetically before "CS" (ACCT, ANTH, ART, BIOL...) came
   first in ALL_COURSES' own subject-sorted order. Ranked low to high:
   code starts with the query (typing "cs" or "cs 14"), code contains it
   (a bare course number like "1401"), title starts with it, title
   contains it. Array.sort is stable, so within each rank the original
   subject/course-number order survives untouched. */
function courseSearchRank(c, q, qNoSpace){
  const codeNoSpace = c.code.toLowerCase().replace(/\s+/g,"");
  const title = (c.title||"").toLowerCase();
  if(codeNoSpace.startsWith(qNoSpace)) return 0;
  if(codeNoSpace.includes(qNoSpace)) return 1;
  if(title.startsWith(q)) return 2;
  if(title.includes(q)) return 3;
  return -1;
}

function renderResults(q){
  const box = $("#courseResults");
  q = (q||"").trim().toLowerCase();
  if(!q){ box.innerHTML = ""; return; }
  const qNoSpace = q.replace(/\s+/g,"");
  const matches = ALL_COURSES
    .map(c => ({ c, rank: courseSearchRank(c, q, qNoSpace) }))
    .filter(x => x.rank !== -1)
    .sort((a,b) => a.rank-b.rank)
    .slice(0,40)
    .map(x => x.c);
  box.innerHTML = matches.length
    ? matches.map(c=>courseRow(c.code, c.title, state.picked.has(c.code))).join("")
    : '<div class="empty">No courses match that search.</div>';
  wireToggles();
}

function wireToggles(){
  $$("[data-toggle]").forEach(b=>{
    b.onclick = () => {
      const c = b.dataset.toggle;
      if(state.picked.has(c)){
        state.picked.delete(c); state.chosen.delete(c);
        if(state.activeCourse===c) state.activeCourse=null;
      } else state.picked.add(c);
      saveState();
      renderStats(); renderSelected(); renderResults($("#courseSearch").value); renderChrome();
    };
  });
}

let searchTimer;
$("#courseSearch").addEventListener("input", e=>{
  $("#courseSearchClear").hidden = !e.target.value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(()=>renderResults(e.target.value), 120);
});
$("#courseSearchClear").onclick = () => {
  const box = $("#courseSearch");
  box.value = "";
  box.focus();
  $("#courseSearchClear").hidden = true;
  renderResults("");
};

/* Loads the course list for one term and re-renders everything that
   depends on it. newTermCode is only passed from the dropdown's onchange
   (see renderStats()) -- the initial page load calls this with no
   argument and just goes with whatever state.termCode already is (null
   the first time a student ever opens this page, meaning "give me the
   latest term"). setTerm() (see app.js) is what actually clears picks/
   cache on a real switch, so this function itself doesn't need to know
   whether the term changed, only what to do once loading finishes. */
async function loadForTerm(newTermCode){
  if(newTermCode !== undefined && newTermCode !== state.termCode) setTerm(newTermCode);
  const hint = $("#courseHint");
  hint.textContent = "Loading real course and instructor data…";
  try{
    const data = await fetch(withTerm("/api/courses")).then(r=>r.json());
    // Syncs state.termCode to the term the server actually resolved --
    // matters on first load, when state.termCode was still null and the
    // server picked "latest" on its own; the dropdown needs the real
    // code to mark the right <option selected>.
    state.termCode = data.termCode || null;
    saveState();
    TERM_LABEL = data.term || TERM_LABEL;
    saveCatalogCache();
    ALL_COURSES = data.courses;
    hint.textContent = ALL_COURSES.length
      ? ALL_COURSES.length.toLocaleString()+" courses offered "+(data.term||"this term")+". Type to search."
      : "No course data yet -- the schedule hasn't been scraped.";
    $("#courseSearch").value = "";
    $("#courseSearchClear").hidden = true;
    renderStats();
    renderSelected();
    renderResults("");
    renderChrome();
  } catch(e){
    hint.textContent = "Couldn't load course data.";
  }
}

(async ()=>{
  await ensureTerms().then(t => TERM_OPTIONS = t);
  await loadForTerm();
  hidePageLoading();
})();

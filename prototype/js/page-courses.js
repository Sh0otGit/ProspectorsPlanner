/* =====================================================================
   STEP 2: search real UTEP course offerings and pick which ones you
   still need. Replaces the old fixed personalized requirement list --
   there's no real substitute for that yet (it needs the degree
   evaluation parser, deliberately last in the build order, see
   CLAUDE.md) -- with a search against every course actually offered
   this term, from /api/courses.
   ===================================================================== */
let ALL_COURSES = [];

function courseRow(code, title, selected){
  return '<div class="crnrow"><div class="crntop"><span><b>'+esc(code)+'</b><br>'
    + '<span style="color:var(--ink-muted);font-size:11.5px">'+esc(title||"")+'</span></span>'
    + '<button class="btn xs '+(selected?"":"blue")+'" data-toggle="'+esc(code)+'">'+(selected?"Remove":"Add")+'</button></div></div>';
}

function renderStats(){
  $("#statbar").style.gridTemplateColumns = "repeat(3,1fr)"; // this page has 3 stats, not the usual 4
  $("#statbar").innerHTML =
    '<div><div class="lab">Term</div><div class="val" style="font-size:18px">'+esc(TERM_LABEL||"N/A")+'</div></div>'
  + '<div><div class="lab">Courses offered</div><div class="val">'+ALL_COURSES.length+'</div><div class="sub">this term</div></div>'
  + '<div><div class="lab">Selected</div><div class="val">'+state.picked.size+'</div><div class="sub">course'+(state.picked.size===1?"":"s")+'</div></div>';
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

function renderResults(q){
  const box = $("#courseResults");
  q = (q||"").trim().toLowerCase();
  if(!q){ box.innerHTML = ""; return; }
  const matches = ALL_COURSES.filter(c => (c.code+" "+c.title).toLowerCase().includes(q)).slice(0,40);
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
  clearTimeout(searchTimer);
  searchTimer = setTimeout(()=>renderResults(e.target.value), 120);
});

(async ()=>{
  const hint = $("#courseHint");
  try{
    const [term, data] = await Promise.all([ensureTerm(), fetch("/api/courses").then(r=>r.json())]);
    ALL_COURSES = data.courses;
    hint.textContent = ALL_COURSES.length
      ? ALL_COURSES.length.toLocaleString()+" courses offered "+term+". Type to search."
      : "No course data yet -- the schedule hasn't been scraped.";
    renderStats();
    renderSelected();
  } catch(e){
    hint.textContent = "Couldn't load course data.";
  }
})();

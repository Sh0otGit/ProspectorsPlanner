/* =====================================================================
   STEP 4: rank instructors per selected course, from real data.
   CATALOG/CATALOG_TITLE are fetched on demand (see ensureCatalog in
   app.js) rather than available synchronously the way the old fabricated
   CATALOG was, so this whole page waits on that fetch before its first
   render. No RMP data exists (never scraped, see CLAUDE.md) and no seat
   counts exist (not published anywhere public) -- both are left out of
   the UI entirely rather than shown as a permanent "n/a".
   ===================================================================== */
async function init(){
  const codes = activeCodes();
  if(!codes.length){
    $("#courseTabs").innerHTML = '<div class="empty">No courses selected.</div>';
    $("#resultsList").innerHTML = '<div class="panel"><div class="empty">Go back and search for the courses you need first.</div></div>';
    return;
  }
  $("#resultsList").innerHTML = '<div class="panel"><div class="empty">Loading real course and instructor data&hellip;</div></div>';
  try{
    await ensureCatalog(codes);
  } catch(e){
    $("#resultsList").innerHTML = '<div class="panel"><div class="empty">Couldn\'t load course data. Try reloading.</div></div>';
    return;
  }
  renderResults();
}

function renderResults(){
  const codes = activeCodes();
  if(!state.activeCourse || !codes.includes(state.activeCourse)) state.activeCourse = codes[0];

  const hideConflict = $("#fHideConflict").checked;
  const onlyData     = $("#fOnlyData").checked;

  $("#courseTabs").innerHTML = codes.map(code=>{
    const title = CATALOG_TITLE[code];
    const pick = state.chosen.get(code);
    const profs = CATALOG[code] || [];
    const conflicts = pick ? conflictCount(code) : 0;
    return '<button class="ctab'+(code===state.activeCourse?" on":"")+(pick?" added":"")+'" data-tab="'+esc(code)+'">'
      + '<span class="c">'+esc(code)+'</span>'
      + '<span class="t">'+(title?esc(title):"")+'</span>'
      + '<span class="s">'
      + (pick ? "CRN "+esc(pick.crn)+" added" : num(profs.length)+" instructor"+(profs.length===1?"":"s"))
      + '</span>'
      + (conflicts ? '<span class="tabconflict">Conflict ('+conflicts+')</span>' : "")
      + '</button>';
  }).join("");
  $$("[data-tab]").forEach(b=>b.onclick=()=>{ state.activeCourse=b.dataset.tab; saveState(); renderResults(); });

  const code = state.activeCourse;
  const title = CATALOG_TITLE[code];
  let profs = (CATALOG[code] || []).slice();
  if(onlyData) profs = profs.filter(p=>p.evalN>0);
  profs.sort((a,b)=>{
    const sa=combined(a), sb=combined(b);
    if(sa==null) return 1; if(sb==null) return -1;
    return sb-sa;
  });
  const pick = state.chosen.get(code);
  const rows = profs.map(p=>profHTML(code,p,hideConflict)).join("");

  $("#resultsList").innerHTML =
    '<section class="coursepanel"><header>'
    + '<span class="code">'+esc(code)+'</span><span class="ttl">'+(title?esc(title):"")+'</span>'
    + (pick ? '<span class="badge on">CRN '+esc(pick.crn)+' added</span>'
            : '<span class="badge">'+num(profs.length)+' instructor'+(profs.length===1?"":"s")+'</span>')
    + '</header>'
    + (rows || '<div class="empty">No instructors match the active filters.</div>')
    + '</section>';

  $$("[data-add]").forEach(b=>{
    b.onclick = () => {
      const c=b.dataset.code, prof=b.dataset.prof, crn=b.dataset.crn;
      const cur = state.chosen.get(c);
      if(cur && cur.crn===crn) state.chosen.delete(c);
      else state.chosen.set(c,{profName:prof,crn:crn});
      saveState();
      renderResults(); renderChrome();
    };
  });
}

function profHTML(code,p,hideConflict){
  const score = combined(p);
  const pick  = state.chosen.get(code);
  let secs = p.sections.slice();
  if(hideConflict) secs = secs.filter(s=>!hitsBlocked(s));
  if(!secs.length) return "";

  const distHTML = p.dist
    ? '<div class="distrib">'
      + '<div class="hdr"><span>Overall rating of the instructor</span><span>'+num(p.evalN)+' responses</span></div>'
      + '<div class="stack">'
      + p.dist.map((v,i)=> v>0
          ? '<span class="'+(i===2?"darktext":"")+'" style="width:'+v+'%;background:var(--r'+(5-i)+')" '
            + 'title="'+DIST_KEYS[i]+': '+v.toFixed(0)+'%">'+(v>=12?v.toFixed(0)+"%":"")+'</span>'
          : "").join("")
      + '</div><div class="distlegend">'
      + DIST_KEYS.map((k,i)=> p.dist[i]>0 ? '<span><i style="background:var(--r'+(5-i)+')"></i>'+k+' '+p.dist[i].toFixed(0)+'%</span>' : "").join("")
      + '</div></div>'
    : '<div class="distrib"><div class="hdr"><span>Overall rating of the instructor</span></div>'
      + '<div style="font-size:13px;color:var(--ink-muted);padding:5px 0">No HB 2504 evaluations on file for this instructor yet.</div></div>';

  const warn = (p.evalN>0 && p.evalN<10)
    ? '<div class="provisional">Based on '+num(p.evalN)+' responses. Treat this rating as provisional.</div>' : "";

  const tip = txt => '<span class="tip" tabindex="0">?<span class="tiptext">'+esc(txt)+'</span></span>';

  return '<div class="prof'+(score==null?" dim":"")+'">'
   + '<div class="prof-main">'
   + '<div class="prof-id">'
     + '<span class="nm">'+esc(p.name)+'</span><span class="dept">'+esc(p.dept||"")+'</span></div>'
   + '<div class="scoreline">'+starsHTML(score)
     + '<span class="bignum">'+(score==null?"n/a":score.toFixed(2))+'</span>'
     + '<span class="of">of 5.00</span></div>'
   + warn + distHTML
   + '<div class="metrics" style="grid-template-columns:1fr;max-width:220px">'
     + '<div><div class="k">UTEP evaluation'+tip("Instructor rating from UTEP course evaluations, published under Texas HB 2504. Shrunk toward the university mean when response counts are low.")+'</div><div class="v">'+(p.evalAdj?p.evalAdj.toFixed(2)+'<span class="unit"> out of 5</span>':"n/a")+'</div></div>'
   + '</div>'
   + '</div>'
   + '<div class="prof-side"><h5>Sections, '+esc(TERM_LABEL||"this term")+'</h5>'
   + secs.map(s=>{
      const blocked = hitsBlocked(s);
      const clash   = hitsEnrolled(s,code);
      const added   = pick && pick.crn===s.crn;
      const when    = s.days.length ? s.days.join("")+" &middot; "+fmt(s.start)+" to "+fmt(s.end) : "Asynchronous";
      return '<div class="sect '+(added?"added":"")+' '+((blocked||clash)&&!added?"conflict":"")+'">'
        + '<div style="display:flex;justify-content:space-between;gap:8px">'
          + '<span class="crn">CRN '+esc(s.crn)+'</span>'
          + '<span style="font-size:11.5px;color:var(--ink-muted)">'+esc(s.scheduleType||"")+'</span></div>'
        + '<div class="when">'+when+'</div>'
        + '<div class="where">'+esc(s.room||"TBA")+'</div>'
        + (blocked?'<div class="warnline">Overlaps a blocked hour</div>':"")
        + (clash?'<div class="warnline">Conflicts with a section you added</div>':"")
        + '<button class="btn sm '+(added?"":"blue")+'" style="margin-top:9px;width:100%" data-add '
          + 'data-code="'+esc(code)+'" data-prof="'+esc(p.name)+'" data-crn="'+esc(s.crn)+'">'
          + (added?"Remove":"Add to schedule")+'</button>'
        + '</div>';
     }).join("")
   + '</div></div>';
}

["fHideConflict","fOnlyData"].forEach(id=>$("#"+id).onchange=renderResults);

init();

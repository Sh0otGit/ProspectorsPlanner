/* =====================================================================
   STEP 4: rank instructors per selected course.
   ===================================================================== */
if(!state.parsed) seedDemo();

function renderResults(){
  const codes = activeCodes();
  if(!codes.length){
    $("#courseTabs").innerHTML = '<div class="empty">No courses selected.</div>';
    $("#resultsList").innerHTML = '<div class="panel"><div class="empty">No sections are available for the courses you selected.</div></div>';
    return;
  }
  if(!state.activeCourse || !codes.includes(state.activeCourse)) state.activeCourse = codes[0];

  const hideConflict = $("#fHideConflict").checked;
  const hideFull     = $("#fHideFull").checked;
  const onlyData     = $("#fOnlyData").checked;

  $("#courseTabs").innerHTML = codes.map(code=>{
    const item = REQS.flatMap(g=>g.items).find(i=>i.code===code);
    const pick = state.chosen.get(code);
    const nProf = CATALOG[code].length;
    const conflicts = pick ? conflictCount(code) : 0;
    return '<button class="ctab'+(code===state.activeCourse?" on":"")+(pick?" added":"")+'" data-tab="'+esc(code)+'">'
      + '<span class="c">'+esc(code)+'</span>'
      + '<span class="t">'+(item?esc(item.title):"")+'</span>'
      + '<span class="s">'
      + (pick ? "CRN "+esc(pick.crn)+" added" : num(nProf)+" instructor"+(nProf===1?"":"s"))
      + '</span>'
      + (conflicts ? '<span class="tabconflict">Conflict ('+conflicts+')</span>' : "")
      + '</button>';
  }).join("");
  $$("[data-tab]").forEach(b=>b.onclick=()=>{ state.activeCourse=b.dataset.tab; saveState(); renderResults(); });

  const code = state.activeCourse;
  const item = REQS.flatMap(g=>g.items).find(i=>i.code===code);
  let profs = CATALOG[code].slice();
  if(onlyData) profs = profs.filter(p=>p.evalN>0);
  profs.sort((a,b)=>{
    const sa=combined(a), sb=combined(b);
    if(sa==null) return 1; if(sb==null) return -1;
    return sb-sa;
  });
  const pick = state.chosen.get(code);
  const rows = profs.map(p=>profHTML(code,p,hideConflict,hideFull)).join("");

  $("#resultsList").innerHTML =
    '<section class="coursepanel"><header>'
    + '<span class="code">'+esc(code)+'</span><span class="ttl">'+(item?esc(item.title):"")+'</span>'
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

  $$("details[data-rev]").forEach(d=>{
    d.ontoggle = ()=>{
      const nm = d.dataset.rev;
      if(d.open) state.revOpen.add(nm); else state.revOpen.delete(nm);
      saveState();
    };
  });
  $$("[data-revpage]").forEach(b=>{
    b.onclick = e => {
      e.preventDefault(); e.stopPropagation();
      state.revPage[b.dataset.revprof] = +b.dataset.revpage;
      saveState();
      renderResults();
    };
  });
}

/* Sorted by rating only for now. See sortReviews below if that changes. */
function sortReviews(list){
  return list.slice().sort((a,b)=>b.q-a.q);
}

/* « first, ‹ back, up to three page numbers centered on the current
   page, › forward, » last. */
function pagerHTML(page, pages, nm){
  if(pages<=1) return "";
  const nav = (i,label,disabled)=>'<button data-revpage="'+i+'" data-revprof="'+esc(nm)+'"'+(disabled?" disabled":"")+'>'+label+'</button>';
  const num = (i)=>'<button data-revpage="'+i+'" data-revprof="'+esc(nm)+'" class="'+(i===page?"on":"")+'">'+(i+1)+'</button>';
  let mid = "";
  for(let i=Math.max(0,page-1); i<=Math.min(pages-1,page+1); i++) mid += num(i);
  return '<div class="revpages">'
    + nav(0,"&laquo;",page===0)
    + nav(Math.max(0,page-1),"&lsaquo;",page===0)
    + mid
    + nav(Math.min(pages-1,page+1),"&rsaquo;",page===pages-1)
    + nav(pages-1,"&raquo;",page===pages-1)
    + '</div>';
}

function reviewsHTML(p){
  const raw = p.reviews || [];
  if(!raw.length) return "";
  const all = sortReviews(raw);
  const pages = Math.ceil(all.length / REVIEWS_PER_PAGE);
  let page = state.revPage[p.name] || 0;
  if(page > pages-1) page = pages-1;
  const slice = all.slice(page*REVIEWS_PER_PAGE, page*REVIEWS_PER_PAGE + REVIEWS_PER_PAGE);
  const nm = p.name;

  return '<details class="reviews" data-rev="'+esc(nm)+'"'+(state.revOpen.has(nm)?" open":"")+'>'
    + '<summary>View Rate My Professors reviews ('+all.length+')</summary>'
    + '<div class="revlist">'
    + slice.map(r=>
        '<div class="rev" style="border-left-color:'+qColor(r.q)+'">'
        + '<div class="rev-top">'
          + '<span class="rev-q" style="background:'+qColor(r.q)+'">'+r.q+'.0</span>'
          + '<span class="rev-course">'+esc(r.course)+'</span>'
          + '<span>'+esc(r.date)+'</span>'
          + '<span>Difficulty '+r.d+'.0</span>'
          + '<span>Grade '+esc(r.grade)+'</span>'
          + '<span>'+(r.wta?"Would take again":"Would not take again")+'</span>'
        + '</div>'
        + '<div class="rev-text">'+esc(r.text)+'</div>'
        + (r.tags?'<div class="rev-tags">'+r.tags.map(t=>'<span class="rev-tag">'+esc(t)+'</span>').join("")+'</div>':"")
        + '</div>').join("")
    + '</div>'
    + '<div class="revnav">'
      + '<span class="pg">Page '+(page+1)+' of '+pages+'</span>'
      + '<span class="spacer"></span>'
      + pagerHTML(page,pages,nm)
    + '</div>'
    + '</details>';
}

function profHTML(code,p,hideConflict,hideFull){
  const score = combined(p);
  const pick  = state.chosen.get(code);
  let secs = p.sections.slice();
  if(hideConflict) secs = secs.filter(s=>!hitsBlocked(s));
  if(hideFull)     secs = secs.filter(s=>s.seats>0);
  if(!secs.length) return "";

  const distHTML = p.dist
    ? '<div class="distrib">'
      + '<div class="hdr"><span>Overall rating of the instructor</span><span>'+num(p.evalN)+' responses</span></div>'
      + '<div class="stack">'
      + p.dist.map((v,i)=> v>0
          ? '<span class="'+(i===2?"darktext":"")+'" style="width:'+v+'%;background:var(--r'+(5-i)+')" '
            + 'title="'+DIST_KEYS[i]+': '+v+'%">'+(v>=12?v+"%":"")+'</span>'
          : "").join("")
      + '</div><div class="distlegend">'
      + DIST_KEYS.map((k,i)=> p.dist[i]>0 ? '<span><i style="background:var(--r'+(5-i)+')"></i>'+k+' '+p.dist[i]+'%</span>' : "").join("")
      + '</div></div>'
    : '<div class="distrib"><div class="hdr"><span>Overall rating of the instructor</span></div>'
      + '<div style="font-size:13px;color:var(--ink-muted);padding:5px 0">No published evaluations. '
      + (p.newHire?"First term teaching at UTEP.":"No HB 2504 record on file.")+'</div></div>';

  const warn = p.lowN ? '<div class="provisional">Based on '+num(p.evalN)+' responses. Treat this rating as provisional.</div>' : "";

  const tip = txt => '<span class="tip" tabindex="0">?<span class="tiptext">'+esc(txt)+'</span></span>';

  return '<div class="prof'+(score==null?" dim":"")+'">'
   + '<div class="prof-main">'
   + '<div class="prof-id">'
     + '<span class="nm">'+esc(p.name)+'</span><span class="dept">'+esc(p.dept)+'</span></div>'
   + '<div class="scoreline">'+starsHTML(score)
     + '<span class="bignum">'+(score==null?"n/a":score.toFixed(2))+'</span>'
     + '<span class="of">of 5.00</span></div>'
   + warn + distHTML
   + '<div class="metrics">'
     + '<div><div class="k">UTEP evaluation'+tip("Instructor rating from UTEP course evaluations, published under Texas HB 2504. Shrunk toward the university mean when response counts are low.")+'</div><div class="v">'+(p.evalAdj?p.evalAdj.toFixed(2)+'<span class="unit"> out of 5</span>':"n/a")+'</div></div>'
     + '<div><div class="k">Rate My Professors'+tip("Aggregate quality rating from Rate My Professors, a third-party site. Self-selected reviews, not a UTEP source.")+'</div><div class="v">'+(p.rmp?p.rmp.score.toFixed(1)+'<span class="unit"> out of 5</span>':"n/a")+'</div></div>'
     + '<div><div class="k">Difficulty'+tip("Self-reported course difficulty from Rate My Professors. Not part of the UTEP evaluation.")+'</div><div class="v">'+(p.rmp?p.rmp.diff.toFixed(1)+'<span class="unit"> out of 5</span>':"n/a")+'</div></div>'
   + '</div>'
   + reviewsHTML(p)
   + '</div>'
   + '<div class="prof-side"><h5>Sections, '+esc(STUDENT.term)+'</h5>'
   + secs.map(s=>{
      const blocked = hitsBlocked(s);
      const clash   = hitsEnrolled(s,code);
      const added   = pick && pick.crn===s.crn;
      const full    = s.seats===0;
      const when    = s.days.length ? s.days.join("")+" &middot; "+fmt(s.start)+" to "+fmt(s.end) : "Asynchronous";
      return '<div class="sect '+(added?"added":"")+' '+((blocked||clash)&&!added?"conflict":"")+'">'
        + '<div style="display:flex;justify-content:space-between;gap:8px">'
          + '<span class="crn">CRN '+esc(s.crn)+'</span>'
          + '<span style="font-size:11.5px;color:var(--ink-muted)">'+esc(s.mode)+'</span></div>'
        + '<div class="when">'+when+'</div>'
        + '<div class="where">'+esc(s.room)+'</div>'
        + '<div class="seats '+(s.seats<=5?"low":"")+'">'+(full?"Closed, 0 seats":s.seats+" of "+s.cap+" seats open")+'</div>'
        + (blocked?'<div class="warnline">Overlaps a blocked hour</div>':"")
        + (clash?'<div class="warnline">Conflicts with a section you added</div>':"")
        + '<button class="btn sm '+(added?"":"blue")+'" style="margin-top:9px;width:100%" data-add '
          + 'data-code="'+esc(code)+'" data-prof="'+esc(p.name)+'" data-crn="'+esc(s.crn)+'" '
          + (full&&!added?"disabled":"")+'>'+(added?"Remove":"Add to schedule")+'</button>'
        + '</div>';
     }).join("")
   + '</div></div>';
}

["fHideConflict","fHideFull","fOnlyData"].forEach(id=>$("#"+id).onchange=renderResults);

renderResults();

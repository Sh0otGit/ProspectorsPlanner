/* =====================================================================
   STEP 4: rank instructors per selected course, from real data.
   CATALOG/CATALOG_TITLE are fetched on demand (see ensureCatalog in
   app.js) rather than available synchronously the way the old fabricated
   CATALOG was, so this whole page waits on that fetch before its first
   render. RMP data (aggregate + a bounded review sample) is real when a
   Banner name matches an rmp_professors row -- see server/lib/catalog.js
   and scrapers/rmp.js -- and every RMP block links back to the source
   page, per CLAUDE.md's plan for this source. No seat counts exist (not
   published anywhere public), left out of the UI entirely.
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

  $("#courseTabs").innerHTML = codes.map(code=>{
    const title = CATALOG_TITLE[code];
    const pick = state.chosen.get(code);
    const profs = CATALOG[code] || [];
    /* Both kinds of problem a picked section can have -- clashing with
       another added course, and sitting on a blocked hour -- count toward
       this badge, not just the course-vs-course kind. A section that does
       both showed "Conflict (1)" before, hiding the blocked-hour half. */
    const pickSec = pick ? getChosenSection(code) : null;
    const issues = pickSec ? conflictCount(code) + (hitsBlocked(pickSec)?1:0) : 0;
    return '<button class="ctab'+(code===state.activeCourse?" on":"")+(pick?" added":"")+'" data-tab="'+esc(code)+'">'
      + '<span class="c">'+esc(code)+'</span>'
      + '<span class="t">'+(title?esc(title):"")+'</span>'
      + '<span class="s">'
      + (pick ? "CRN "+esc(pick.crn)+" added" : num(profs.length)+" instructor"+(profs.length===1?"":"s"))
      + '</span>'
      + (issues ? '<span class="tabconflict">Conflict ('+issues+')</span>' : "")
      + '</button>';
  }).join("");
  $$("[data-tab]").forEach(b=>b.onclick=()=>{ state.activeCourse=b.dataset.tab; saveState(); renderResults(); });

  const code = state.activeCourse;
  const title = CATALOG_TITLE[code];
  let profs = (CATALOG[code] || []).slice();
  profs.sort((a,b)=>{
    const sa=combined(a), sb=combined(b);
    if(sa==null) return 1; if(sb==null) return -1;
    return sb-sa;
  });
  const pick = state.chosen.get(code);
  const rows = profs.map(p=>profHTML(code,p)).join("");

  $("#resultsList").innerHTML =
    '<section class="coursepanel"><header>'
    + '<span class="code">'+esc(code)+'</span><span class="ttl">'+(title?esc(title):"")+'</span>'
    + (pick ? '<span class="badge on">CRN '+esc(pick.crn)+' added</span>'
            : '<span class="badge">'+num(profs.length)+' instructor'+(profs.length===1?"":"s")+'</span>')
    + '</header>'
    + (rows || '<div class="empty">No instructors listed for this course this term.</div>')
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

/* « first, ‹ back, the current page number (plain, not a button list), ›
   forward, » last. Same shape reused by server/admin/js/data.js's pager. */
function pagerHTML(page, pages, nm){
  if(pages<=1) return "";
  const nav = (i,label,disabled)=>'<button data-revpage="'+i+'" data-revprof="'+esc(nm)+'"'+(disabled?" disabled":"")+'>'+label+'</button>';
  return '<div class="revpages">'
    + nav(0,"&laquo;",page===0)
    + nav(Math.max(0,page-1),"&lsaquo;",page===0)
    + '<span class="pgnum">'+(page+1)+'</span>'
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
    + '<summary>View Rate My Professors reviews ('+all.length+')'
      + (p.rmp && p.rmp.wta!=null ? ' <span class="wta">&middot; '+Math.round(p.rmp.wta)+'% would take again</span>' : "")
    + '</summary>'
    + '<div class="revlist">'
    + slice.map(r=>
        '<div class="rev" style="border-left-color:'+qColor(Math.round(r.q))+'">'
        + '<div class="rev-top">'
          + '<span class="rev-q'+([3,4].includes(Math.round(r.q))?" darktext":"")+'" style="background:'+qColor(Math.round(r.q))+'">'+r.q.toFixed(1)+'</span>'
          + '<span class="rev-course">'+esc(r.course)+'</span>'
          + '<span>'+esc(r.date)+'</span>'
          + (r.d!=null?'<span>Difficulty '+r.d.toFixed(1)+'</span>':"")
          + (r.grade?'<span>Grade '+esc(r.grade)+'</span>':"")
          + (r.wta!=null?'<span>'+(r.wta?"Would take again":"Would not take again")+'</span>':"")
        + '</div>'
        + '<div class="rev-text">'+esc(r.text)+'</div>'
        + (r.tags&&r.tags.length?'<div class="rev-tags">'+r.tags.map(t=>'<span class="rev-tag">'+esc(t)+'</span>').join("")+'</div>':"")
        + '</div>').join("")
    + '</div>'
    + '<div class="revnav">'
      + '<span class="pg">Page '+(page+1)+' of '+pages+'</span>'
      + '<span class="spacer"></span>'
      + pagerHTML(page,pages,nm)
    + '</div>'
    + (p.rmp ? '<a href="https://www.ratemyprofessors.com/professor/'+esc(p.rmp.legacyId)+'" target="_blank" rel="noopener" class="rmpsrc">Source: Rate My Professors</a>' : "")
    + '</details>';
}

/* One thin source row of the combined distribution bar -- see distHTML in
   profHTML below. Bucket text doesn't fit inside a bar this thin, so the
   per-segment breakdown lives in the title tooltip instead; the shared
   legend under both rows still names the five buckets by color. */
function distRowHTML(label, dist, n, unit){
  if(!dist) return "";
  return '<div class="distrow">'
    + '<span class="distsrc">'+label+'</span>'
    + '<div class="stack">'
    + dist.map((v,i)=> v>0
        ? '<span style="width:'+v+'%;background:var(--r'+(5-i)+')" title="'+DIST_KEYS[i]+': '+v.toFixed(0)+'%"></span>'
        : "").join("")
    + '</div>'
    + '<span class="distn">'+num(n)+' '+unit+'</span>'
    + '</div>';
}

function profHTML(code,p){
  const score = combined(p);
  const pick  = state.chosen.get(code);
  const secs = p.sections.slice();
  if(!secs.length) return "";

  const rmpDist = p.rmp && p.rmp.dist;
  const distHTML = (p.dist || rmpDist)
    ? '<div class="distrib">'
      + '<div class="hdr"><span>Overall rating of the instructor</span></div>'
      + distRowHTML("UTEP", p.dist, p.evalN, "responses")
      + distRowHTML("RMP", rmpDist, p.rmp?.n, "ratings")
      + '<div class="distlegend">'
      + DIST_KEYS.map((k,i)=>'<span><i style="background:var(--r'+(5-i)+')"></i>'+k+'</span>').join("")
      + '</div></div>'
    : '<div class="distrib"><div class="hdr"><span>Overall rating of the instructor</span></div>'
      + '<div style="font-size:13px;color:var(--ink-muted);padding:5px 0">No UTEP evaluation or Rate My Professors rating distribution on file for this instructor yet.</div></div>';

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
   + '<div class="metrics">'
     + '<div><div class="k">UTEP evaluation'+tip("Instructor rating from UTEP course evaluations, published under Texas HB 2504. Shrunk toward the university mean when response counts are low.")+'</div><div class="v">'+(p.evalAdj?p.evalAdj.toFixed(2)+'<span class="unit"> out of 5</span>':"n/a")+'</div></div>'
     + '<div><div class="k">Rate My Professors'+tip("Aggregate quality rating from Rate My Professors, a third-party site. Self-selected reviews, not a UTEP source.")+'</div><div class="v">'+(p.rmp?p.rmp.score.toFixed(1)+'<span class="unit"> out of 5</span>':"n/a")+'</div></div>'
     + '<div><div class="k">Difficulty'+tip("Self-reported course difficulty from Rate My Professors. Not part of the UTEP evaluation.")+'</div><div class="v">'+(p.rmp&&p.rmp.diff!=null?p.rmp.diff.toFixed(1)+'<span class="unit"> out of 5</span>':"n/a")+'</div></div>'
   + '</div>'
   + reviewsHTML(p)
   + '</div>'
   + '<div class="prof-side"><h2>Sections, '+esc(TERM_LABEL||"this term")+'</h2>'
   + '<div class="sectlist">'
   + secs.map(s=>{
      const blocked = hitsBlocked(s);
      const clashWith = conflictingCodes(s,code);
      const clash = clashWith.length>0;
      const added   = pick && pick.crn===s.crn;
      const when    = s.days.length ? s.days.join("")+" &middot; "+fmt(s.start)+" to "+fmt(s.end) : "Asynchronous";
      return '<div class="sect '+(added?"added":"")+' '+((blocked||clash)&&!added?"conflict":"")+'">'
        + '<div style="display:flex;justify-content:space-between;gap:8px">'
          + '<span class="crn">CRN '+esc(s.crn)+'</span>'
          + '<span style="font-size:11.5px;color:var(--ink-muted)">'+esc(s.scheduleType||"")+'</span></div>'
        + '<div class="when'+(clash?" clashtime":"")+'">'+when+'</div>'
        + '<div class="where">'+esc(s.room||"TBA")+'</div>'
        + (blocked?'<div class="warnline">Overlaps a blocked hour</div>':"")
        + (clash?'<div class="warnline">Conflicts with '+clashWith.map(esc).join(", ")+'</div>':"")
        + '<button class="btn sm '+(added?"":"blue")+'" style="margin-top:9px;width:100%" data-add '
          + 'data-code="'+esc(code)+'" data-prof="'+esc(p.name)+'" data-crn="'+esc(s.crn)+'">'
          + (added?"Remove":"Add to schedule")+'</button>'
        + '</div>';
     }).join("")
   + '</div></div></div>';
}


init();

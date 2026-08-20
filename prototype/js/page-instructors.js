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
  scrollToChosenSection();
}

/* Jumps the page to the professor card teaching a section already added
   for the active course (the first .sect the render below marks "added" --
   a course can now have two, a lecture and its seminar, but they're
   almost always taught by the same instructor, so landing on either
   one's card is the useful outcome), and scrolls that card's own section
   list so the added section is visible inside it too. Called on tab
   switches, the initial load, and after arriving from a class clicked on
   the Schedule page (see data-goto-code in page-schedule.js) -- not from
   every re-render, so paging through reviews or clicking Add doesn't
   yank the page around while the student is already looking at the right
   spot. No-ops harmlessly when the active course has no added section
   yet. */
function scrollToChosenSection(){
  const sectEl = $(".sect.added");
  if(!sectEl) return;
  const profEl = sectEl.closest(".prof");
  if(!profEl) return;
  const list = sectEl.closest(".sectlist");
  if(list){
    const listRect = list.getBoundingClientRect();
    const sectRect = sectEl.getBoundingClientRect();
    list.scrollTo({ top: list.scrollTop + (sectRect.top - listRect.top) - 12, behavior: "smooth" });
  }
  profEl.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* .prof-main and .prof-side size to their own natural content
   (see .prof's align-items:start in styles.css), so matching them up
   is a two-way job: .sectlist gets capped (and stays scrollable) so a
   long section list can't push .prof-side taller than the card, and
   .prof-side itself gets a min-height so its grey background still
   reaches the card's bottom edge when the section list is *shorter*
   than the card -- a single-section professor otherwise left the grey
   panel stopping well short of .prof-main's own height, with a plain
   white gap (and no border) below it. "chrome" below is .prof-side's
   own padding/heading height (everything in that column besides the
   list itself), measured live rather than hard-coded so it stays
   correct if that markup ever changes. Skipped once .prof stacks to a
   single column under the mobile breakpoint (styles.css), where
   .prof-main and .prof-side are no longer side by side and nothing
   needs matching. */
function syncSectionListHeights(){
  $$(".prof").forEach(p=>{
    const main = p.querySelector(".prof-main"), side = p.querySelector(".prof-side"), list = p.querySelector(".sectlist");
    if(!main || !side || !list) return;
    side.style.minHeight = "";
    list.style.maxHeight = "";
    const mainRect = main.getBoundingClientRect(), sideRect = side.getBoundingClientRect();
    if(Math.abs(mainRect.top - sideRect.top) > 2) return;
    const chrome = sideRect.height - list.getBoundingClientRect().height;
    list.style.maxHeight = Math.max(140, mainRect.height - chrome) + "px";
    side.style.minHeight = mainRect.height + "px";
  });
}

/* Both disclaimers come from server/lib/catalog.js's per-course
   requiresLab/components fields (see CATALOG_META in app.js) -- neither
   is a guess rendered client-side, both are derived from real scraped
   data (a lab section's own title naming its parent course; a course's
   own set of distinct schedule_type values). Neither can name the exact
   CRN pairing Banner enforces at registration (that lives behind
   Banner 9 SSB's CAS login, confirmed not publicly accessible), so both
   say so plainly and point to an advisor/professor instead of pretending
   to know. */
function companionNoticesHTML(code){
  const meta = CATALOG_META[code];
  if(!meta) return "";
  let html = "";
  if(meta.requiresLab){
    const lab = meta.requiresLab;
    const labCode = esc(lab.subject+" "+lab.courseNumber);
    html += '<div class="companion-notice">This class has a required lab, <b>'+labCode+'</b>'
      + (lab.title ? " ("+esc(lab.title)+")" : "") + '. Search for it separately and add a section. '
      + "If you're unsure which "+labCode+" section is correct for your lecture, ask your advisor or professor.</div>";
  }
  if(meta.components && meta.components.length>1){
    const kinds = meta.components.map(shortType);
    html += '<div class="companion-notice">This class has more than one required part: <b>'+kinds.map(esc).join("</b> and <b>")+'</b>. '
      + "You can add one section of each below -- they'll show up as separate classes on your schedule. "
      + "If you're unsure which sections go together, ask your advisor or professor.</div>";
  }
  return html;
}

function renderResults(){
  const codes = activeCodes();
  if(!state.activeCourse || !codes.includes(state.activeCourse)) state.activeCourse = codes[0];

  $("#courseTabs").innerHTML = codes.map(code=>{
    const title = CATALOG_TITLE[code];
    const entries = chosenEntries(code);
    const profs = CATALOG[code] || [];
    // conflictCount() already sums conflicts/blocked-hours across every
    // section chosen for this course (there can be more than one now --
    // a lecture and its seminar).
    const issues = conflictCount(code);
    return '<button class="ctab'+(code===state.activeCourse?" on":"")+(entries.length?" added":"")+'" data-tab="'+esc(code)+'">'
      + '<span class="c">'+esc(code)+'</span>'
      + '<span class="t">'+(title?esc(title):"")+'</span>'
      + '<span class="s">'
      + (entries.length ? entries.map(e=>"CRN "+esc(e.crn)).join(", ")+" added" : num(profs.length)+" instructor"+(profs.length===1?"":"s"))
      + '</span>'
      + (issues ? '<span class="tabconflict">Conflict ('+issues+')</span>' : "")
      + '</button>';
  }).join("");
  $$("[data-tab]").forEach(b=>b.onclick=()=>{
    state.activeCourse=b.dataset.tab;
    // A review left open for one course's instructor reads as stale (or,
    // if the same person also teaches the new course, misleadingly
    // pre-expanded) once you've switched to a different course entirely.
    state.revOpen.clear();
    saveState();
    renderResults();
    scrollToChosenSection();
  });

  const code = state.activeCourse;
  const title = CATALOG_TITLE[code];
  let profs = (CATALOG[code] || []).slice();
  profs.sort((a,b)=>{
    const sa=combined(a), sb=combined(b);
    if(sa==null) return 1; if(sb==null) return -1;
    return sb-sa;
  });
  const entries = chosenEntries(code);
  const rows = profs.map(p=>profHTML(code,p)).join("");

  $("#resultsList").innerHTML =
    companionNoticesHTML(code)
    + '<section class="coursepanel"><header>'
    + '<span class="code">'+esc(code)+'</span><span class="ttl">'+(title?esc(title):"")+'</span>'
    + (entries.length ? '<span class="badge on">'+entries.map(e=>"CRN "+esc(e.crn)).join(", ")+' added</span>'
            : '<span class="badge">'+num(profs.length)+' instructor'+(profs.length===1?"":"s")+'</span>')
    + '</header>'
    + (rows || '<div class="empty">No instructors listed for this course this term.</div>')
    + '</section>';

  syncSectionListHeights();

  /* .res-side (the "Your courses" panel) is position:sticky, which only
     has room to stay pinned to the viewport for as long as its own grid
     row is taller than the sidebar itself -- normally true, since the
     professor list is the long side. A course with only one or two
     professors flips that: the sidebar (course tabs + Scoring panel)
     becomes the taller column, the row's height collapses to match it
     exactly, and sticky has zero slack left to work with, so instead of
     staying pinned it scrolls away with the page the moment you scroll
     past it -- confirmed against POLS 3300 (2 professors): switching to
     its tab left "Your courses" ~360px above the viewport instead of
     pinned at the top.

     A flat pixel buffer isn't enough: scrollToChosenSection() can ask
     the page to scroll as far as the results column's own natural
     height (bringing a professor near its very bottom up to the
     viewport's top), and sticky only keeps its pin through a scroll
     that large if the row has at least that much extra room *beyond*
     the sidebar's own height. So the added room has to scale with the
     results column's natural height too, not just the sidebar's --
     confirmed by measuring the actual break point against POLS 3300
     rather than guessing a bigger constant. Reset to "" first so this
     reads the column's real natural height, not a min-height left over
     from a previous render. */
  const side = $(".res-side"), results = $("#resultsList");
  results.style.minHeight = "";
  // .res-side drops to position:static under the mobile breakpoint (see
  // styles.css), where this workaround is both unnecessary (nothing to
  // keep pinned) and actively unwanted (it'd just add blank space below
  // a short course's cards on a phone).
  if(side && results && getComputedStyle(side).position === "sticky"){
    const naturalResults = results.scrollHeight;
    results.style.minHeight = (naturalResults + side.scrollHeight + 40) + "px";
  }

  $$("[data-add]").forEach(b=>{
    b.onclick = () => {
      const c=b.dataset.code, prof=b.dataset.prof, crn=b.dataset.crn, type=b.dataset.type;
      // One active pick per distinct schedule_type, not one per course --
      // adding a section only replaces a previous pick of that *same*
      // type (e.g. swapping which Lecture section you added), leaving a
      // different type's pick (e.g. a already-added Seminar) untouched.
      let byType = state.chosen.get(c);
      const cur = byType ? byType.get(type) : null;
      if(cur && cur.crn===crn){
        byType.delete(type);
        if(byType.size===0) state.chosen.delete(c);
      } else {
        if(!byType){ byType = new Map(); state.chosen.set(c, byType); }
        byType.set(type, {profName:prof, crn:crn});
      }
      saveState();
      renderResults(); renderChrome();
    };
  });

  $$("details[data-rev]").forEach(d=>{
    d.ontoggle = ()=>{
      const nm = d.dataset.rev;
      if(d.open) state.revOpen.add(nm); else state.revOpen.delete(nm);
      saveState();
      // Opening/closing this <details> is a native browser toggle, not a
      // renderResults() re-render -- it changes .prof-main's height (a
      // lot, once the review list shows) without going through the pass
      // above that keeps .prof-side matched to it. Confirmed against
      // Jesse Adam Kapenga's card: expanding his 55 reviews left the
      // section sidebar's background and border exactly where they were
      // when the card was still short, well short of the now much taller
      // card's bottom edge.
      syncSectionListHeights();
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
  const entries = chosenEntries(code);
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
      const myEntry = entries.find(e=>e.crn===s.crn);
      const added   = !!myEntry;
      const clashWith = conflictingCodes(s,code,s.scheduleType);
      const clash = clashWith.length>0;
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
          + 'data-code="'+esc(code)+'" data-prof="'+esc(p.name)+'" data-crn="'+esc(s.crn)+'" data-type="'+esc(s.scheduleType||"")+'">'
          + (added?"Remove":"Add to schedule")+'</button>'
        + '</div>';
     }).join("")
   + '</div></div></div>';
}


init();

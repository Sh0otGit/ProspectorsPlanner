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
    hidePageLoading();
    return;
  }
  $("#resultsList").innerHTML = '<div class="panel"><div class="empty">Loading real course and instructor data&hellip;</div></div>';
  try{
    await ensureCatalog(codes);
  } catch(e){
    $("#resultsList").innerHTML = '<div class="panel"><div class="empty">Couldn\'t load course data. Try reloading.</div></div>';
    hidePageLoading();
    return;
  }
  renderResults();
  scrollToChosenSection();
  hidePageLoading();
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
   to know. The prerequisite line below them is a plain gray informational
   notice, not a red warning like the two above -- there's nothing to fix
   here, it's the same "here's a fact about this course" register as the
   registration-window note on the Schedule page (see regWindowNoteHTML
   in page-schedule.js), so it reuses the same neutral .notice class
   rather than .companion-notice's red-flagged one. */
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
  if(meta.prereq){
    html += '<div class="notice" style="margin:0 0 14px">This class requires <b>'+esc(meta.prereq)+'</b> to be completed first.</div>';
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
  let profs = (CATALOG[code] || []).slice();
  profs.sort((a,b)=>{
    const sa=combined(a), sb=combined(b);
    if(sa==null) return 1; if(sb==null) return -1;
    return sb-sa;
  });
  const rows = profs.map(p=>profHTML(code,p)).join("");

  $("#resultsList").innerHTML =
    companionNoticesHTML(code)
    + (rows || '<div class="empty">No instructors listed for this course this term.</div>');

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

  // A username matched, but that doesn't guarantee a real photo is on
  // file with HB 2504 -- swap to the "No image set" placeholder on a
  // load failure instead of leaving a broken-image icon. Wired here, not
  // an inline onerror="" attribute, since this project's CSP has no
  // 'unsafe-inline' for script-src (see server/index.js's buildCsp).
  $$("img.avatar.photo").forEach(img=>{
    img.onerror = () => { img.outerHTML = avatarEmptyHTML(img.dataset.prof); };
  });
  // Delegated on the container rather than wired per-avatar: an img that
  // 404s gets swapped out for the "No image set" placeholder above, after
  // this pass already ran, and a per-element listener wouldn't follow it
  // to the replacement element. data-prof (set on both the photo and the
  // empty placeholder) is the key back to this course's own profs array.
  $("#resultsList").onclick = e => {
    const el = e.target.closest(".avatar");
    if(!el) return;
    const p = profs.find(x=>x.name===el.dataset.prof);
    if(p) showPhotoModal(p);
  };
  $("#resultsList").onkeydown = e => {
    if(e.key!=="Enter" && e.key!==" ") return;
    const el = e.target.closest(".avatar");
    if(!el) return;
    e.preventDefault();
    const p = profs.find(x=>x.name===el.dataset.prof);
    if(p) showPhotoModal(p);
  };

  // Re-measure once "See full breakdown" changes .prof-main's height --
  // see syncSectionListHeights's own header comment for why .prof-side
  // needs a live min-height at all.
  $$("details.breakdown").forEach(d=>{
    d.addEventListener("toggle", syncSectionListHeights);
  });

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
        logEvent("add_to_schedule", { code: c, crn, type });
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

/* Full breakdown chart shown inside "See full breakdown" (see profHTML
   below): one pair of bars per category, UTEP solid and RMP a lighter
   tint of the same color, so "Excellent" always reads green regardless
   of source instead of needing two separate legends. A single-source
   professor (only one of utepDist/rmpDist real) draws one centered bar
   per category instead of a pair. Category names sit right under their
   own bars, so unlike the old stacked bars this needs no separate color
   legend at all -- what a bar's color and position mean is already
   spelled out on the chart itself. */
function groupedBarChartSVG(utepDist, rmpDist, utepN, rmpN){
  const scale = 2.5, baseline = 148, groupW = 100, barW = 30, gapBar = 4;
  const hasBoth = utepDist && rmpDist;
  const totalW = 20 + DIST_KEYS.length*groupW;
  let bars = "";
  DIST_KEYS.forEach((label,i)=>{
    const x0 = 10 + i*groupW;
    const color = "var(--r"+(5-i)+")";
    if(hasBoth){
      const ux = x0+19, rx = ux+barW+gapBar;
      const uv = utepDist[i], rv = rmpDist[i];
      const uh = uv*scale, uy = baseline-uh, rh = rv*scale, ry = baseline-rh;
      bars += '<rect x="'+ux+'" y="'+uy+'" width="'+barW+'" height="'+uh+'" fill="'+color+'"></rect>'
        + '<rect x="'+rx+'" y="'+ry+'" width="'+barW+'" height="'+rh+'" fill="'+color+'" opacity="0.4"></rect>'
        + '<text x="'+(ux+barW/2)+'" y="'+(uy-6)+'" text-anchor="middle" class="gbarval">'+uv.toFixed(0)+'%</text>'
        + '<text x="'+(rx+barW/2)+'" y="'+(ry-6)+'" text-anchor="middle" class="gbarval">'+rv.toFixed(0)+'%</text>';
    } else {
      const v = (utepDist || rmpDist)[i];
      const bx = x0+(groupW-barW)/2, bh = v*scale, by = baseline-bh;
      bars += '<rect x="'+bx+'" y="'+by+'" width="'+barW+'" height="'+bh+'" fill="'+color+'"></rect>'
        + '<text x="'+(bx+barW/2)+'" y="'+(by-6)+'" text-anchor="middle" class="gbarval">'+v.toFixed(0)+'%</text>';
    }
    bars += '<text x="'+(x0+groupW/2)+'" y="'+(baseline+22)+'" text-anchor="middle" class="gbarcat">'+label+'</text>';
  });
  return '<svg class="groupedchart" viewBox="0 0 '+totalW+' '+(baseline+36)+'" role="img" aria-label="Rating distribution by category">'
    + '<line x1="10" y1="'+baseline+'" x2="'+(totalW-10)+'" y2="'+baseline+'" stroke="var(--rule-strong)"></line>'
    + bars
    + '</svg>'
    + (hasBoth ? '<div class="gbarsrc"><span><i style="background:var(--rule-strong)"></i>UTEP (solid) &middot; '+num(utepN)+' evaluations</span>'
        + '<span><i style="background:var(--rule-strong);opacity:.4"></i>RMP (lighter) &middot; '+num(rmpN)+' ratings</span></div>' : "");
}

/* The default-visible summary of one source's distribution: a dominant-
   category label ("Mostly Excellent (57%)") plus a small shape cue,
   instead of the full labeled stacked bar (still available one click
   away via groupedBarChartSVG above) -- replaces the old two full-width
   bars, which read as the actual friction point, not just "too much
   detail." A genuine near-tie between the top categories (within 4
   points) is shown
   as a split rather than picking one arbitrarily, since claiming a
   single "mostly X" when two categories are essentially equal would be
   its own kind of wrong answer. */
function sentimentRowHTML(label, dist, n, unit){
  if(!dist) return "";
  const max = Math.max(...dist);
  const tied = dist.map((v,i)=>i).filter(i=>dist[i]>0 && max-dist[i]<=4);
  let dotStyle, labelText;
  if(tied.length>1){
    const colors = tied.map(i=>"var(--r"+(5-i)+")");
    const step = 100/colors.length;
    const stops = colors.map((c,i)=>c+" "+(i*step)+"%, "+c+" "+((i+1)*step)+"%").join(", ");
    dotStyle = "background:linear-gradient(90deg,"+stops+")";
    labelText = "Split: "+tied.map(i=>DIST_KEYS[i]+" "+dist[i].toFixed(0)+"%").join(" &middot; ");
  } else {
    const i = dist.indexOf(max);
    dotStyle = "background:var(--r"+(5-i)+")";
    labelText = "Mostly "+DIST_KEYS[i]+" ("+max.toFixed(0)+"%)";
  }
  const strip = dist.map((v,i)=> v>0 ? '<span style="width:'+v+'%;background:var(--r'+(5-i)+')"></span>' : "").join("");
  return '<div class="srow">'
    + '<span class="ssrc">'+label+'</span>'
    + '<span class="sdot" style="'+dotStyle+'"></span>'
    + '<span class="slbl">'+labelText+'</span>'
    + '<span class="sstrip">'+strip+'</span>'
    + '<span class="sn">'+num(n)+' '+unit+'</span>'
    + '</div>';
}

/* Shown immediately for an instructor with no HB 2504 username at all,
   and swapped in by the onerror wiring in renderResults() when a
   username exists but its /photos/{username}.jpg 404s (not every profile
   has uploaded one) -- plain text saying so, not a guessed placeholder
   image, same "no data, not a guess" rule as everywhere else this
   project handles a missing value. */
/* data-prof carries the instructor's name so the click delegation in
   renderResults() can look the full professor object back up -- same key
   already used for data-rev/data-add elsewhere in this file, and the
   reason instructor names are treated as a unique key within one course's
   results throughout this page, not just here. */
function avatarEmptyHTML(name){
  return '<div class="avatar empty" tabindex="0" role="button" data-prof="'+esc(name||"")+'" aria-label="No image set. View instructor information.">No image set</div>';
}
/* HB 2504 hosts a real headshot per profile at /photos/{username}.jpg
   (confirmed 2026-09-13 live against a real profile) -- hotlinked
   straight from hb2504.utep.edu, not re-hosted, same "browser fetches a
   real third-party image directly" pattern the Map page's OSM tiles
   already use. p.username is null for an instructor with no HB 2504
   match at all, which skips the image entirely rather than requesting a
   URL that can't exist. tabindex/role match .bldgpin's own pattern in
   page-map.js for a real clickable element (opens the info popup, see
   showPhotoModal) rather than a decorative image alt="" now that
   clicking it does something. */
function avatarHTML(p){
  if(!p.username) return avatarEmptyHTML(p.name);
  return '<img class="avatar photo" tabindex="0" role="button" data-prof="'+esc(p.name)+'" src="https://hb2504.utep.edu/photos/'+esc(p.username)+'.jpg" alt="View '+esc(p.name)+'’s photo and instructor information">';
}

/* One line per profile.js's decode-entities-flattened field -- each line
   already reads fine on its own (a bio sentence, a "- Degree, School
   (year)" bullet from the scraper's own "- " list marker), so this just
   turns line breaks into paragraph breaks rather than trying to re-detect
   which fields are lists. Returns "" (not rendered at all) for a field
   nobody has on file, same "no data, not a guess" rule as everywhere else
   -- there is no "Not listed" placeholder text, the whole section is
   just absent.

   collapsible sections (Bio, Education, Scholarly and Creative Activity --
   Grants tends to run short in practice, so it stays as-is) get a
   height-clamped body plus a hidden "Read more" button; wireReadMore()
   below only un-hides it for a section whose real content actually
   overflows that clamp, measured after insertion rather than guessed
   from line count (a single long bio paragraph with zero line breaks
   needs clamping just as much as a 15-line publication list does). */
function profileSectionHTML(label, text, collapsible){
  if(!text) return "";
  const body = text.split("\n").map(line=>'<p>'+esc(line)+'</p>').join("");
  return '<section class="profinfo-sec">'
    + '<h3>'+esc(label)+'</h3>'
    + '<div class="profinfo-secbody'+(collapsible?" clamped":"")+'">'+body+'</div>'
    + (collapsible ? '<button type="button" class="profinfo-readmore" hidden>Read more</button>' : "")
    + '</section>';
}

/* Only shows the button for a section that actually needs it -- a short
   bio's clamp never clips anything, so scrollHeight and clientHeight
   come back equal and it stays hidden. Re-run on every showPhotoModal()
   call since the DOM is rebuilt from scratch each time. */
function wireReadMore(root){
  root.querySelectorAll(".profinfo-secbody.clamped").forEach(body=>{
    const btn = body.nextElementSibling;
    if(!btn || !btn.classList.contains("profinfo-readmore")) return;
    if(body.scrollHeight <= body.clientHeight + 2) return;
    body.classList.add("overflowing");
    btn.hidden = false;
    btn.onclick = () => {
      const expanded = body.classList.toggle("expanded");
      btn.textContent = expanded ? "Read less" : "Read more";
    };
  });
}

/* One shared popup element, created on first use and reused -- same
   "build once, toggle" pattern as calTipEl/mapTipEl elsewhere in this
   project rather than a fresh element per professor. Its whole content
   (photo, office/phone/email, bio/education/scholarly activity/grants)
   is rebuilt per open rather than templated once, since which fields
   exist varies per instructor. Closes on the X, a click on the dimmed
   backdrop, or Escape; the close button is a real <button> (not a bare
   "x") so it's reachable by keyboard and announced properly. */
let photoModalEl = null;
function showPhotoModal(p){
  if(!photoModalEl){
    photoModalEl = document.createElement("div");
    photoModalEl.className = "photomodal";
    document.body.appendChild(photoModalEl);
    photoModalEl.onclick = e => { if(e.target===photoModalEl) hidePhotoModal(); };
    document.addEventListener("keydown", e => { if(e.key==="Escape") hidePhotoModal(); });
  }
  const profile = p.profile;
  // Bold "Label:" prefix per line, matching HB 2504's own profile page
  // layout (a real reference screenshot of it is what this was built
  // against) instead of the old comma-joined single lines -- easier to
  // scan, and each field still only renders when that instructor
  // actually has it on file.
  const contactLines = [];
  if(profile && profile.officeBuilding) contactLines.push('<div class="profinfo-line"><b>Office Building:</b> '+esc(profile.officeBuilding)+'</div>');
  if(profile && profile.officeRoom) contactLines.push('<div class="profinfo-line"><b>Office Room:</b> '+esc(profile.officeRoom)+'</div>');
  if(profile && profile.phone) contactLines.push('<div class="profinfo-line"><b>Phone:</b> '+esc(profile.phone)+'</div>');
  if(profile && profile.email) contactLines.push('<div class="profinfo-line"><b>Email:</b> <a href="mailto:'+esc(profile.email)+'">'+esc(profile.email)+'</a></div>');

  // p.dept can be more than one department joined with " - " (a joint
  // appointment, e.g. "Political Science and Public Administration -
  // Economics and Finance" -- see faculty_directory.js's parseDirectory)
  // -- each becomes its own line here, same as HB 2504's own page.
  const deptLines = (p.dept ? p.dept.split(" - ") : []).map(d=>'<div class="profinfo-dept">'+esc(d)+'</div>').join("");

  const sections = profile
    ? profileSectionHTML("Bio", profile.bio, true)
      + profileSectionHTML("Education", profile.education, true)
      + profileSectionHTML("Scholarly and Creative Activity", profile.scholarlyActivity, true)
      + profileSectionHTML("Grants", profile.grants)
    : "";

  photoModalEl.innerHTML =
    '<div class="photomodal-card">'
      + '<button type="button" class="photomodal-close" aria-label="Close">&times;</button>'
      + '<div class="photomodal-head">'
        + (p.username ? '<img class="photomodal-img" alt="Photo of '+esc(p.name)+'">' : '<div class="photomodal-imgempty" aria-hidden="true">No image set</div>')
        + '<div class="photomodal-headtext">'
          + '<h2>'+esc(p.name)+'</h2>'
          + (p.title ? '<div class="profinfo-title">'+esc(p.title)+'</div>' : "")
          + deptLines
          + (contactLines.length ? '<div class="profinfo-contact">'+contactLines.join("")+'</div>' : "")
        + '</div>'
      + '</div>'
      + (sections || '<div class="profinfo-empty">No HB 2504 profile information on file for this instructor yet.</div>')
    + '</div>';

  photoModalEl.querySelector(".photomodal-close").onclick = hidePhotoModal;
  const img = photoModalEl.querySelector(".photomodal-img");
  if(img){
    // Wired before src is set, same reasoning as renderResults()'s own
    // onerror wiring -- a cached 404 can fail synchronously.
    img.onerror = () => { img.outerHTML = '<div class="photomodal-imgempty" aria-hidden="true">No image set</div>'; };
    img.src = "https://hb2504.utep.edu/photos/"+encodeURIComponent(p.username)+".jpg";
  }
  photoModalEl.classList.add("open");
  // Only after .open (display:flex) -- everything inside still measures
  // as zero-height while the modal itself is display:none, which would
  // make every clamped section look like it overflows.
  wireReadMore(photoModalEl);
}
function hidePhotoModal(){
  if(photoModalEl) photoModalEl.classList.remove("open");
}

function profHTML(code,p){
  const score = combined(p);
  const entries = chosenEntries(code);
  const secs = p.sections.slice();
  if(!secs.length) return "";

  const rmpDist = p.rmp && p.rmp.dist;
  const tip = txt => '<span class="tip" tabindex="0">?<span class="tiptext">'+esc(txt)+'</span></span>';
  // Moved inside the "See full breakdown" disclosure below, alongside the
  // full bars -- not shown by default any more than those are.
  const metricsHTML = '<div class="metrics">'
     + '<div><div class="k">UTEP evaluation'+tip("Instructor rating from UTEP course evaluations, published under Texas HB 2504. Shrunk toward the university mean when response counts are low.")+'</div><div class="v">'+(p.evalAdj?p.evalAdj.toFixed(2)+'<span class="unit"> out of 5</span>':"n/a")+'</div></div>'
     + '<div><div class="k">Rate My Professors'+tip("Aggregate quality rating from Rate My Professors, a third-party site. Self-selected reviews, not a UTEP source.")+'</div><div class="v">'+(p.rmp?p.rmp.score.toFixed(1)+'<span class="unit"> out of 5</span>':"n/a")+'</div></div>'
     + '<div><div class="k">Difficulty'+tip("Self-reported course difficulty from Rate My Professors. Not part of the UTEP evaluation.")+'</div><div class="v">'+(p.rmp&&p.rmp.diff!=null?p.rmp.diff.toFixed(1)+'<span class="unit"> out of 5</span>':"n/a")+'</div></div>'
   + '</div>';
  const distHTML = (p.dist || rmpDist)
    ? '<div class="distrib">'
      + '<div class="hdr"><span>Overall rating of the instructor</span></div>'
      + '<div class="sentiment">'
      + sentimentRowHTML("UTEP", p.dist, p.evalN, "evaluations")
      + sentimentRowHTML("RMP", rmpDist, p.rmp?.n, "ratings")
      + '</div>'
      + '<details class="breakdown"><summary>See full breakdown</summary>'
      + groupedBarChartSVG(p.dist, rmpDist, p.evalN, p.rmp?.n)
      + metricsHTML
      + '</details></div>'
    : '<div class="distrib"><div class="hdr"><span>Overall rating of the instructor</span></div>'
      + '<div style="font-size:13px;color:var(--ink-muted);padding:5px 0">No UTEP evaluation or Rate My Professors rating distribution on file for this instructor yet.</div>'
      // A score can exist (see combined()) without a bucketed distribution
      // to go with it -- e.g. an RMP aggregate with no per-review dist
      // pull -- in which case the metrics grid still has something real
      // to show. Genuinely nothing at all (no eval, no RMP) skips the
      // disclosure entirely rather than offering to reveal three "n/a"s.
      + (p.evalAdj!=null || p.rmp ? '<details class="breakdown"><summary>See full breakdown</summary>'+metricsHTML+'</details>' : "")
      + '</div>';

  const warn = (p.evalN>0 && p.evalN<10)
    ? '<div class="provisional">Based on '+num(p.evalN)+' responses. Treat this rating as provisional.</div>' : "";

  return '<div class="prof'+(score==null?" dim":"")+'">'
   + '<div class="prof-main">'
   + '<div class="prof-id">'
     + '<div class="prof-idtext">'
       + '<div class="prof-idname"><span class="nm">'+esc(p.name)+'</span><span class="dept">'+esc(p.dept||"")+'</span></div>'
       + '<div class="scoreline">'+starsHTML(score)
         + '<span class="bignum">'+(score==null?"n/a":score.toFixed(2))+'</span>'
         + '<span class="of">of 5.00</span></div>'
     + '</div>'
     + avatarHTML(p)
   + '</div>'
   + warn + distHTML
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

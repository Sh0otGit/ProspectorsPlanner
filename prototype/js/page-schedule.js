/* =====================================================================
   STEP 5: rendered schedule grid and CRN worksheet.
   ===================================================================== */
// Ten distinct colors, not five -- a student can have more picks than
// that once a course with a required lab/seminar counts as two (see
// server/lib/catalog.js's components), and reusing a color after five
// made two genuinely unrelated classes look like the same one at a
// glance. None of these are red; see the --series-3.. definitions in
// styles.css for why.
const PALETTE = ["--series-1","--series-2","--r4","--star","--r5","--series-3","--series-4","--series-5","--series-6","--series-7"];

/* Null if this pick's section has no time problem, otherwise a plain-
   English clause ("overlaps POLS 3315.") for the Copy CRN confirmation
   dialog -- reuses the same conflictingCodes()/hitsBlocked() app.js
   already computes for the calendar and Instructors page, so this is
   never a second, possibly-out-of-sync notion of "conflict." */
function describeTimeConflict(code, scheduleType){
  const entry = state.chosen.get(code)?.get(scheduleType);
  const sec = entry ? resolveSection(code, entry) : null;
  if(!sec) return null;
  const clashWith = conflictingCodes(sec, code, scheduleType);
  const blocked = hitsBlocked(sec);
  if(!clashWith.length && !blocked) return null;
  const parts = [];
  if(clashWith.length) parts.push("overlaps "+clashWith.join(", "));
  if(blocked) parts.push("overlaps an hour you marked unavailable");
  return parts.join(" and ")+".";
}

function renderSchedule(){
  /* {code, profName, section, scheduleType} for every added pick, resolved
     live from CATALOG. A course can now contribute more than one pick
     (a lecture and its own seminar, e.g. PHYS 2320 -- see
     server/lib/catalog.js's components field and app.js's
     allChosenSections()), each with its own CRN and time, so the
     calendar keys everything below off the *pick* (its CRN), never off
     the course code alone -- two picks sharing a code are still two
     separate calendar entries with two separate times. */
  const picks = allChosenSections().map(({code, entry, sec}) =>
    ({code, profName:entry.profName, scheduleType:entry.scheduleType, section:sec}));

  /* slot key -> list of picks occupying it, identified by CRN */
  const map=new Map();
  picks.forEach((pk,i)=>sectionSlots(pk.section).forEach(k=>{
    if(!map.has(k)) map.set(k,[]);
    map.get(k).push({code:pk.code, crn:pk.section.crn, i});
  }));

  /* conflicting course pairs, for the note text below the grid -- two
     picks under the *same* code (a course's own lecture and seminar
     genuinely overlapping) still show as e.g. "PHYS 2320 and PHYS 2320",
     which reads a little redundant but is not wrong: it is that course's
     own two parts colliding. */
  const pairs=new Set();
  map.forEach(v=>{
    if(v.length>1) for(let a=0;a<v.length;a++) for(let b=a+1;b<v.length;b++)
      pairs.add([v[a].code,v[b].code].sort().join(" and "));
  });

  calSkeleton("#schedCal",(d,i)=>{
    const k=d+"-"+i, evs=map.get(k);
    if(!evs) return '<td class="'+(state.blocked.has(k)?"blocked":"")+'"></td>';

    /* Only THIS slot overlapping turns it red. A class that conflicts
       somewhere else in its run keeps its normal color everywhere it
       doesn't actually overlap. Adjacent overlapping slots drop the
       border on their shared edge (border-collapse merges a 0-width
       side away) so a whole overlapping run reads as one clean red
       box, not a stack of individually outlined cells. */
    if(evs.length>1){
      const prevOverlap = (map.get(d+"-"+(i-1))||[]).length>1;
      const nextOverlap = (map.get(d+"-"+(i+1))||[]).length>1;
      const codes = [...new Set(evs.map(e=>e.code))];
      const crns = [...new Set(evs.map(e=>e.crn))];
      const cls = "hasclass overlap"+(prevOverlap?" contTop":"")+(nextOverlap?" contBottom":"");
      return '<td class="'+cls+'">'
        + '<div class="ovblock" role="button" tabindex="0" data-goto-code="'+esc(codes[0])+'" data-crns="'+esc(crns.join(","))+'" '
        + 'aria-label="Conflict between '+codes.map(esc).join(" and ")+'. Click to fix in Instructors.">'
        + (!prevOverlap?'<span class="lbl">'+codes.map(esc).join(" / ")+'</span>':"")
        + '</div></td>';
    }

    const prev = map.get(d+"-"+(i-1)) || [];
    const next = map.get(d+"-"+(i+1)) || [];
    const blocked = state.blocked.has(k);
    const blocks = evs.map(ev=>{
      const first = !prev.some(x=>x.crn===ev.crn);
      const last  = !next.some(x=>x.crn===ev.crn);
      const c = "var("+PALETTE[ev.i%PALETTE.length]+")";
      // A single class sitting on an hour the student marked unavailable
      // gets the same red outline treatment as two classes overlapping
      // each other, just on top of the class's own color instead of
      // replacing it with .ovblock's solid red -- this is one class with
      // a scheduling problem, not two classes fighting over a slot, so
      // it should still read as that one class. contTop/contBottom below
      // mirror td.overlap's own continuity trick (checked against the
      // *same CRN* in the adjacent slot, not just "is that slot also
      // blocked," so a blocked run only merges into one box while it's
      // actually the same class the whole way through).
      const prevBlocked = blocked && state.blocked.has(d+"-"+(i-1)) && prev.some(x=>x.crn===ev.crn);
      const nextBlocked = blocked && state.blocked.has(d+"-"+(i+1)) && next.some(x=>x.crn===ev.crn);
      // --c carries this block's own palette color as a custom property so
      // the .hoverblk rule below can mix a deeper shade of the *same*
      // color rather than a foreign hover color. first/last (already
      // computed for the plain border above) double as the hover outline's
      // own contTop/contBottom-style continuity flags -- a class spanning
      // several half-hour slots hovers as one unbroken box, not a stack of
      // individually outlined cells, the same fix already applied to the
      // conflict/overlap outline. data-crn (not code) is the hover/highlight
      // identity -- a lecture and its own seminar share a code but must not
      // cross-highlight each other, they're different sections at different
      // times. data-goto-code stays a plain course code since either one
      // should land on the same Instructors tab.
      return '<span class="blk'+(first?" first":"")+(last?" last":"")+(blocked?" blockconflict":"")+(blocked&&!prevBlocked?" contTop":"")+(blocked&&!nextBlocked?" contBottom":"")+'" data-crn="'+esc(ev.crn)+'" '
        + 'role="button" tabindex="0" data-goto-code="'+esc(ev.code)+'" '
        + 'aria-label="'+esc(ev.code)+(blocked?". Overlaps an hour you marked unavailable.":"")+' Click to view or edit in Instructors." style="'
        + '--c:'+c+';background:color-mix(in srgb,'+c+' 20%,#fff);border-color:'+c+'">'
        + (first?'<span class="lbl">'+esc(ev.code)+'</span>':"")
        + '</span>';
    }).join("");
    return '<td class="hasclass"><div class="blkrow">'+blocks+'</div></td>';
  });

  $$("[data-goto-code]").forEach(el=>{
    const go = () => {
      state.activeCourse = el.dataset.gotoCode;
      state.revOpen.clear();
      saveState();
      location.href = "instructors.html";
    };
    el.onclick = go;
    // role="button" on a div doesn't get native Enter/Space activation the
    // way a real <button> would -- has to be wired by hand.
    el.onkeydown = e => {
      if(e.key==="Enter" || e.key===" "){ e.preventDefault(); go(); }
    };
  });

  wireCalHover(picks);

  $("#conflictNote").innerHTML = pairs.size
    ? '<div class="conflictnote"><b>Time conflict.</b> '
      + [...pairs].map(esc).join("; ")+' overlap. The overlapping time is outlined in red. '
      + 'Click it to fix the conflict in Instructors. Goldmine will reject these CRNs together.</div>'
    : "";

  $("#schedLegend").innerHTML = picks.map((pk,i)=>
    '<span><i class="swatch" style="background:color-mix(in srgb,var('+PALETTE[i%PALETTE.length]+') 20%,#fff);border-color:var('+PALETTE[i%PALETTE.length]+')"></i>'+esc(pk.code)
      + (pk.scheduleType?' <span style="color:var(--ink-muted)">('+esc(shortType(pk.scheduleType))+')</span>':"")+'</span>').join("")
    + '<span><i class="swatch" style="background:repeating-linear-gradient(45deg,#f2d7d5,#f2d7d5 4px,#e8c4c1 4px,#e8c4c1 8px)"></i>Blocked</span>'
    + (pairs.size?'<span><i class="swatch" style="background:var(--critical)"></i>Overlap</span>':"");

  $("#crnList").innerHTML = picks.length
    ? picks.map(pk=>{
        const title = CATALOG_TITLE[pk.code];
        return '<div class="crnrow"><div class="crntop">'
          + '<span class="crn-info"><b>CRN '+esc(pk.section.crn)+'</b>'
          + (title?'<span class="crn-title">'+esc(title)+'</span>':"")
          + '<span class="crn-code">'+esc(pk.code)+(pk.scheduleType?" &middot; "+esc(shortType(pk.scheduleType)):"")+'</span>'
          + '<span class="crn-prof">'+esc(pk.profName)+'</span></span>'
          + '<span class="crn-when">'
          + (pk.section.days.length?pk.section.days.join("")+"<br>"+fmt(pk.section.start):"Online")
          + '<button class="btn xs" data-copy-crn="'+esc(pk.section.crn)+'" data-code="'+esc(pk.code)+'" data-type="'+esc(pk.scheduleType||"")+'">Copy CRN</button>'
          + '</span></div></div>';
      }).join("")
    : '<div style="color:var(--ink-muted);font-size:13.5px">No sections added.</div>';

  $$("[data-copy-crn]").forEach(b=>{
    const label = b.textContent;
    b.onclick = () => {
      const crn = b.dataset.copyCrn, code = b.dataset.code, type = b.dataset.type;
      const conflict = describeTimeConflict(code, type);
      if(conflict && !confirm("Are you sure? CRN "+crn+" ("+code+") "+conflict+" Goldmine may reject conflicting CRNs together.")){
        return;
      }
      if(navigator.clipboard) navigator.clipboard.writeText(crn).catch(()=>{});
      $("#copyMsg").textContent = "Copied CRN "+crn+".";
      setTimeout(()=>$("#copyMsg").textContent="",2200);
      // On the button itself too, right where the click happened, not
      // just the shared message line below the whole worksheet.
      b.textContent = "Copied!";
      b.classList.add("copied");
      clearTimeout(b._copiedTimer);
      b._copiedTimer = setTimeout(()=>{
        b.textContent = label;
        b.classList.remove("copied");
      }, 1600);
    };
  });
}

/* Hovering any slot of a class highlights every slot that class occupies
   (not just the one under the cursor) and shows a tooltip with what's
   scraped about it. An overlap cell belongs to two or more classes at
   once, so it highlights all of them and the tooltip lists each. Wired
   fresh on every render since calSkeleton() replaces the table's markup
   each time. */
let calTipEl = null;
function wireCalHover(picks){
  // Keyed by CRN, not course code -- a course can now have two picks (a
  // lecture and its seminar) sharing one code, and they must not
  // cross-highlight or share a tooltip row just because they're the
  // same course; they're different sections at different times.
  const byCrn = new Map(picks.map(pk=>[pk.section.crn,pk]));
  if(!calTipEl){
    calTipEl = document.createElement("div");
    calTipEl.className = "calTip";
    document.body.appendChild(calTipEl);
  }

  function rowHTML(crn){
    const pk = byCrn.get(crn);
    if(!pk) return "";
    const title = CATALOG_TITLE[pk.code];
    const s = pk.section;
    const when = s.days.length ? s.days.join("")+" &middot; "+fmt(s.start)+" to "+fmt(s.end) : "Asynchronous";
    return '<div class="calTipRow"><b>'+esc(pk.code)+'</b>'+(title?" &middot; "+esc(title):"")+(pk.scheduleType?" &middot; "+esc(shortType(pk.scheduleType)):"")+'<br>'
      + 'CRN '+esc(s.crn)+' &middot; '+esc(pk.profName)+'<br>'
      + when + (s.room?' &middot; '+esc(s.room):"")+'</div>';
  }

  const cal = $("#schedCal");
  cal.onmouseover = e => {
    const el = e.target.closest("[data-crn],[data-crns]");
    if(!el) return;
    const crns = el.dataset.crn ? [el.dataset.crn] : el.dataset.crns.split(",");
    $$("[data-crn]",cal).forEach(x=>x.classList.toggle("hoverblk", crns.includes(x.dataset.crn)));
    $$("[data-crns]",cal).forEach(x=>x.classList.toggle("hoverblk", x.dataset.crns.split(",").some(c=>crns.includes(c))));
    calTipEl.innerHTML = crns.map(rowHTML).join("");
    calTipEl.style.display = "block";
  };
  cal.onmousemove = e => {
    if(calTipEl.style.display!=="block") return;
    calTipEl.style.left = (e.pageX+16)+"px";
    calTipEl.style.top = (e.pageY+16)+"px";
  };
  cal.onmouseleave = () => {
    $$("[data-crn],[data-crns]",cal).forEach(x=>x.classList.remove("hoverblk"));
    calTipEl.style.display = "none";
  };
}

/* =====================================================================
   Feedback card. Posts to the server's /api/reviews (see server/index.js),
   which is the one place this data lives -- an admin viewing the Reviews
   page from any machine sees the same list. Anonymous by default: rating
   is the only required field, name and text are optional.
   ===================================================================== */
let reviewRating = 0;

function paintStars(upTo){
  $$("#reviewStars .star").forEach(b=>{
    b.classList.toggle("sel", +b.dataset.star <= upTo);
  });
}
$$("#reviewStars .star").forEach(b=>{
  b.onclick = () => { reviewRating = +b.dataset.star; paintStars(reviewRating); };
  b.onmouseenter = () => paintStars(+b.dataset.star);
  b.onmouseleave = () => paintStars(reviewRating);
});

$("#submitReview").onclick = async () => {
  const msg = $("#reviewMsg");
  if(!reviewRating){
    msg.style.color = "var(--critical)";
    msg.textContent = "Pick a star rating first.";
    return;
  }
  try {
    const res = await fetch("/api/reviews", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        rating: reviewRating,
        name: $("#reviewName").value.trim(),
        text: $("#reviewText").value.trim()
      })
    });
    if(!res.ok) throw new Error("request failed");
  } catch(e){
    msg.style.color = "var(--critical)";
    msg.textContent = "Couldn't send that, try again in a moment.";
    return;
  }

  reviewRating = 0;
  paintStars(0);
  $("#reviewName").value = "";
  $("#reviewText").value = "";
  msg.style.color = "var(--good)";
  msg.textContent = "Thanks for the feedback.";
  setTimeout(()=>{ msg.textContent=""; }, 3200);
};

/* Chosen sections' real data (room/time/CRN) has to come from CATALOG,
   which -- unlike the old fabricated one -- isn't populated until fetched.
   A fresh page load (a reload, or arriving straight from a bookmark) has
   an empty CATALOG even though state.chosen already has real picks in it,
   so this re-fetches whatever's needed before the first render instead of
   assuming a prior page already warmed it. */
(async () => {
  try {
    await ensureCatalog([...state.chosen.keys()]);
  } catch(e) { /* renderSchedule() still works with whatever loaded; allChosenSections() just skips the rest */ }
  if(TERM_LABEL) $("#schedHeading").textContent = TERM_LABEL+" schedule";
  renderSchedule();
})();

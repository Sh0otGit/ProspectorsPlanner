/* =====================================================================
   STEP 5: rendered schedule grid and CRN worksheet.
   ===================================================================== */
const PALETTE = ["--series-1","--series-2","--r4","--star","--r5"];

function renderSchedule(){
  /* [code, profName, section] for every added pick, resolved live from CATALOG */
  const picks = [...state.chosen.keys()].map(code=>{
    const c = state.chosen.get(code);
    return {code, profName:c.profName, section:getChosenSection(code)};
  }).filter(p=>p.section);

  /* slot key -> list of classes occupying it */
  const map=new Map();
  picks.forEach((pk,i)=>sectionSlots(pk.section).forEach(k=>{
    if(!map.has(k)) map.set(k,[]);
    map.get(k).push({code:pk.code,i});
  }));

  /* conflicting course pairs, for the note text below the grid */
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
      const cls = "hasclass overlap"+(prevOverlap?" contTop":"")+(nextOverlap?" contBottom":"");
      return '<td class="'+cls+'">'
        + '<div class="ovblock" data-goto-code="'+esc(codes[0])+'" data-codes="'+esc(codes.join(","))+'" '
        + 'aria-label="Conflict between '+codes.map(esc).join(" and ")+'. Click to fix in Instructors.">'
        + (!prevOverlap?'<span class="lbl">'+codes.map(esc).join(" / ")+'</span>':"")
        + '</div></td>';
    }

    const prev = map.get(d+"-"+(i-1)) || [];
    const next = map.get(d+"-"+(i+1)) || [];
    const blocks = evs.map(ev=>{
      const first = !prev.some(x=>x.code===ev.code);
      const last  = !next.some(x=>x.code===ev.code);
      const c = "var("+PALETTE[ev.i%5]+")";
      // --c carries this block's own palette color as a custom property so
      // the .hoverblk rule below can mix a deeper shade of the *same*
      // color rather than a foreign hover color. first/last (already
      // computed for the plain border above) double as the hover outline's
      // own contTop/contBottom-style continuity flags -- a class spanning
      // several half-hour slots hovers as one unbroken box, not a stack of
      // individually outlined cells, the same fix already applied to the
      // conflict/overlap outline.
      return '<span class="blk'+(first?" first":"")+(last?" last":"")+'" data-code="'+esc(ev.code)+'" style="'
        + '--c:'+c+';background:color-mix(in srgb,'+c+' 20%,#fff);border-color:'+c+'">'
        + (first?'<span class="lbl">'+esc(ev.code)+'</span>':"")
        + '</span>';
    }).join("");
    return '<td class="hasclass"><div class="blkrow">'+blocks+'</div></td>';
  });

  $$("[data-goto-code]").forEach(el=>{
    el.onclick = () => {
      state.activeCourse = el.dataset.gotoCode;
      saveState();
      location.href = "instructors.html";
    };
  });

  wireCalHover(picks);

  $("#conflictNote").innerHTML = pairs.size
    ? '<div class="conflictnote"><b>Time conflict.</b> '
      + [...pairs].map(esc).join("; ")+' overlap. The overlapping time is outlined in red. '
      + 'Click it to fix the conflict in Instructors. Goldmine will reject these CRNs together.</div>'
    : "";

  $("#schedLegend").innerHTML = picks.map((pk,i)=>
    '<span><i class="swatch" style="background:color-mix(in srgb,var('+PALETTE[i%5]+') 20%,#fff);border-color:var('+PALETTE[i%5]+')"></i>'+esc(pk.code)+'</span>').join("")
    + '<span><i class="swatch" style="background:repeating-linear-gradient(45deg,#f2d7d5,#f2d7d5 4px,#e8c4c1 4px,#e8c4c1 8px)"></i>Blocked</span>'
    + (pairs.size?'<span><i class="swatch" style="background:var(--critical)"></i>Overlap</span>':"");

  $("#crnList").innerHTML = picks.length
    ? picks.map(pk=>{
        const title = CATALOG_TITLE[pk.code];
        return '<div class="crnrow"><div class="crntop">'
          + '<span class="crn-info"><b>CRN '+esc(pk.section.crn)+'</b>'
          + (title?'<span class="crn-title">'+esc(title)+'</span>':"")
          + '<span class="crn-code">'+esc(pk.code)+'</span>'
          + '<span class="crn-prof">'+esc(pk.profName)+'</span></span>'
          + '<span class="crn-when">'
          + (pk.section.days.length?pk.section.days.join("")+"<br>"+fmt(pk.section.start):"Online")+'</span></div>'
          + '<button class="btn xs" data-copy-crn="'+esc(pk.section.crn)+'">Copy CRN</button></div>';
      }).join("")
    : '<div style="color:var(--ink-muted);font-size:13.5px">No sections added.</div>';

  $$("[data-copy-crn]").forEach(b=>{
    b.onclick = () => {
      const crn = b.dataset.copyCrn;
      if(navigator.clipboard) navigator.clipboard.writeText(crn).catch(()=>{});
      $("#copyMsg").textContent = "Copied CRN "+crn+".";
      setTimeout(()=>$("#copyMsg").textContent="",2200);
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
  const byCode = new Map(picks.map(pk=>[pk.code,pk]));
  if(!calTipEl){
    calTipEl = document.createElement("div");
    calTipEl.className = "calTip";
    document.body.appendChild(calTipEl);
  }

  function rowHTML(code){
    const pk = byCode.get(code);
    if(!pk) return "";
    const title = CATALOG_TITLE[code];
    const s = pk.section;
    const when = s.days.length ? s.days.join("")+" &middot; "+fmt(s.start)+" to "+fmt(s.end) : "Asynchronous";
    return '<div class="calTipRow"><b>'+esc(code)+'</b>'+(title?" &middot; "+esc(title):"")+'<br>'
      + 'CRN '+esc(s.crn)+' &middot; '+esc(pk.profName)+'<br>'
      + when + (s.room?' &middot; '+esc(s.room):"")+'</div>';
  }

  const cal = $("#schedCal");
  cal.onmouseover = e => {
    const el = e.target.closest("[data-code],[data-codes]");
    if(!el) return;
    const codes = el.dataset.code ? [el.dataset.code] : el.dataset.codes.split(",");
    $$("[data-code]",cal).forEach(x=>x.classList.toggle("hoverblk", codes.includes(x.dataset.code)));
    $$("[data-codes]",cal).forEach(x=>x.classList.toggle("hoverblk", x.dataset.codes.split(",").some(c=>codes.includes(c))));
    calTipEl.innerHTML = codes.map(rowHTML).join("");
    calTipEl.style.display = "block";
  };
  cal.onmousemove = e => {
    if(calTipEl.style.display!=="block") return;
    calTipEl.style.left = (e.pageX+16)+"px";
    calTipEl.style.top = (e.pageY+16)+"px";
  };
  cal.onmouseleave = () => {
    $$("[data-code],[data-codes]",cal).forEach(x=>x.classList.remove("hoverblk"));
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
  } catch(e) { /* renderSchedule() still works with whatever loaded; getChosenSection just returns null for the rest */ }
  if(TERM_LABEL) $("#schedHeading").textContent = TERM_LABEL+" schedule";
  renderSchedule();
})();

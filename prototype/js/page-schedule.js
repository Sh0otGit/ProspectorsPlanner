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
        + '<div class="ovblock" data-goto-code="'+esc(codes[0])+'" title="Fix this conflict in Instructors">'
        + (!prevOverlap?'<span class="lbl">'+codes.map(esc).join(" / ")+'</span>':"")
        + '</div></td>';
    }

    const prev = map.get(d+"-"+(i-1)) || [];
    const next = map.get(d+"-"+(i+1)) || [];
    const blocks = evs.map(ev=>{
      const first = !prev.some(x=>x.code===ev.code);
      const last  = !next.some(x=>x.code===ev.code);
      const c = "var("+PALETTE[ev.i%5]+")";
      return '<span class="blk'+(first?" first":"")+(last?" last":"")+'" style="'
        + 'background:color-mix(in srgb,'+c+' 20%,#fff);border-color:'+c+'">'
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
    ? picks.map(pk=>
        '<div class="crnrow"><div class="crntop"><span><b>'+esc(pk.section.crn)+'</b><br>'
        + '<span style="color:var(--ink-muted);font-size:11.5px">'+esc(pk.code)+', '+esc(pk.profName)+'</span></span>'
        + '<span style="text-align:right;font-size:11.5px;color:var(--ink-muted)">'
        + (pk.section.days.length?pk.section.days.join("")+"<br>"+fmt(pk.section.start):"Online")+'</span></div>'
        + '<button class="btn xs" data-copy-crn="'+esc(pk.section.crn)+'">Copy CRN</button></div>').join("")
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

renderSchedule();

/* =====================================================================
   MAP: pins at the buildings your added sections meet in, projected
   from real lat/lng (see server/lib/campusmap.js) onto a simple flat
   SVG -- no external mapping library (this project has zero npm
   dependencies anywhere, see CLAUDE.md), just a linear projection over
   whatever bounding box the actually-relevant points fall into, with a
   longitude correction for latitude (real and visible at this latitude,
   ~31.77N, not a rounding nicety). Campus is small enough that a flat
   projection reads as accurate; a real map-projection library would be
   solving a problem this scale doesn't have.
   ===================================================================== */
const MAP_W = 800, MAP_H = 600, PAD = 56;

let parkingLocations = null; // fetched lazily, only once the toggle is actually used

/* Every added section, tagged with where it stands: a real building match
   (the map's job), a real room this project's map data just doesn't
   cover (Texas Western Hall and a handful of others -- see
   campusmap.js's header for why), or no room at all (async/TBA, nothing
   to plot). server/lib/catalog.js already attached `building` per
   section -- see matchBuilding() in server/lib/campusmap.js -- so no
   matching happens here, just grouping. colorIdx matches its position in
   allChosenSections(), the same indexing page-schedule.js's PALETTE
   assignment uses, so a course reads as the same color on both pages. */
function collectPickedSections(){
  const picks = allChosenSections().map(({code, entry, sec}, i) => ({
    code, crn: entry.crn, profName: entry.profName, scheduleType: entry.scheduleType,
    room: sec.room, title: CATALOG_TITLE[code], colorIdx: i,
    building: sec.building,
    kind: sec.building ? "building" : (sec.room && sec.room!=="TBA") ? "noLocation" : "online",
  }));
  const byBuilding = new Map(); // building.id -> {building, picks:[...]}
  for(const p of picks){
    if(p.kind!=="building") continue;
    if(!byBuilding.has(p.building.id)) byBuilding.set(p.building.id, { building: p.building, picks: [] });
    byBuilding.get(p.building.id).picks.push(p);
  }
  return { picks, byBuilding };
}

/* lat/lng -> {x,y} in the 800x600 viewBox, fit to whatever points are
   actually being shown (building pins plus parking lots, when the
   toggle is on) with padding, preserving real relative distances (one
   shared scale for both axes, not stretched to fill the box) instead of
   distorting campus's actual shape. Falls back to a small fixed span
   for a single point, so one added class doesn't divide by zero. */
function projector(points){
  const lats = points.map(p=>p.lat), lngs = points.map(p=>p.lng);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const midLat = (minLat+maxLat)/2;
  const lngScale = Math.cos(midLat * Math.PI/180);
  const latSpan = Math.max(maxLat-minLat, 0.0012);
  const lngSpanCorrected = Math.max((maxLng-minLng)*lngScale, 0.0012);
  const availW = MAP_W - PAD*2, availH = MAP_H - PAD*2;
  const scale = Math.min(availW/lngSpanCorrected, availH/latSpan);
  const usedW = lngSpanCorrected*scale, usedH = latSpan*scale;
  const offX = PAD + (availW-usedW)/2, offY = PAD + (availH-usedH)/2;
  return (lat,lng) => ({
    x: offX + (lng-minLng)*lngScale*scale,
    y: offY + (maxLat-lat)*scale,
  });
}

let mapTipEl = null;
function showTip(html, x, y){
  if(!mapTipEl){
    mapTipEl = document.createElement("div");
    mapTipEl.className = "calTip";
    document.body.appendChild(mapTipEl);
  }
  mapTipEl.innerHTML = html;
  mapTipEl.style.left = (x+16)+"px";
  mapTipEl.style.top = (y+16)+"px";
  mapTipEl.style.display = "block";
}
function hideTip(){ if(mapTipEl) mapTipEl.style.display = "none"; }

function pinPicksHTML(picks){
  return picks.map(p=>
    '<div class="calTipRow"><b>'+esc(p.code)+'</b>'+(p.title?" &middot; "+esc(p.title):"")+(p.scheduleType?" &middot; "+esc(shortType(p.scheduleType)):"")+'<br>'
    + 'CRN '+esc(p.crn)+' &middot; '+esc(p.profName)+(p.room?' &middot; '+esc(p.room):"")+'</div>'
  ).join("");
}

function whereHTML(p){
  if(p.kind==="building") return esc(p.building.name);
  if(p.kind==="noLocation") return esc(p.room)+' <span style="color:var(--ink-muted)">(no location on file)</span>';
  return "Online/asynchronous";
}

function render(){
  const { picks, byBuilding } = collectPickedSections();
  const groups = [...byBuilding.values()];
  const showParking = $("#parkingToggle").checked;

  if(!state.picked.size){
    $("#mapWrap").innerHTML = '<div class="panel"><div class="empty">No courses selected yet. Add a class in Instructors first.</div></div>';
    $("#mapLegend").innerHTML = "";
    $("#mapCourseList").innerHTML = '<div class="empty">No courses selected yet.</div>';
    return;
  }
  if(!groups.length && !(showParking && parkingLocations?.length)){
    $("#mapWrap").innerHTML = '<div class="panel"><div class="empty">'
      + (picks.length
        ? "None of your added sections have a location on file yet -- either they're online/TBA, or this project's map data doesn't cover that room. See the list on the right."
        : "Add a section in Instructors to see it here.")
      + '</div></div>';
  } else {
    const points = groups.map(g=>g.building).concat(showParking && parkingLocations ? parkingLocations : []);
    const project = projector(points.length ? points : [{lat:31.7735,lng:-106.5045}]); // UTEP's own campus centroid, only reached with zero points to show

    let svg = '<rect x="0" y="0" width="'+MAP_W+'" height="'+MAP_H+'" class="mapbg"></rect>';

    if(showParking && parkingLocations){
      svg += parkingLocations.map(p=>{
        const {x,y} = project(p.lat, p.lng);
        return '<g class="parkpin" tabindex="0" data-tip="'+esc(p.name)+' &middot; Parking"><circle cx="'+x+'" cy="'+y+'" r="5"></circle></g>';
      }).join("");
    }

    svg += groups.map(g=>{
      const {x,y} = project(g.building.lat, g.building.lng);
      const c = "var("+PALETTE[g.picks[0].colorIdx % PALETTE.length]+")";
      const codes = [...new Set(g.picks.map(p=>p.code))];
      return '<g class="bldgpin" tabindex="0" role="button" data-goto-code="'+esc(codes[0])+'" '
        + 'data-tip="'+esc(pinPicksHTML(g.picks))+'" '
        + 'aria-label="'+esc(g.building.name)+': '+esc(codes.join(", "))+'. Click to view in Instructors.">'
        + '<circle cx="'+x+'" cy="'+y+'" r="10" style="--c:'+c+'"></circle>'
        + (g.picks.length>1?'<text x="'+x+'" y="'+(y+4)+'" class="pinbadge">'+g.picks.length+'</text>':"")
        + '<text x="'+x+'" y="'+(y-15)+'" class="pinlabel">'+esc(g.building.name)+'</text>'
        + '</g>';
    }).join("");

    $("#mapWrap").innerHTML = '<svg id="campusMap" viewBox="0 0 '+MAP_W+' '+MAP_H+'" role="img" '
      + 'aria-label="Map of UTEP campus with pins at your added classes\' buildings">'+svg+'</svg>';

    $$(".bldgpin,.parkpin", $("#mapWrap")).forEach(el=>{
      el.onmouseenter = e => showTip(el.dataset.tip, e.pageX, e.pageY);
      el.onmousemove = e => { if(mapTipEl && mapTipEl.style.display==="block"){ mapTipEl.style.left=(e.pageX+16)+"px"; mapTipEl.style.top=(e.pageY+16)+"px"; } };
      el.onmouseleave = hideTip;
      el.onfocus = () => { const r = el.getBoundingClientRect(); showTip(el.dataset.tip, r.left+window.scrollX, r.top+window.scrollY); };
      el.onblur = hideTip;
    });
    $$("[data-goto-code]", $("#mapWrap")).forEach(el=>{
      const go = () => { state.activeCourse = el.dataset.gotoCode; state.revOpen.clear(); saveState(); location.href = "instructors.html"; };
      el.onclick = go;
      el.onkeydown = e => { if(e.key==="Enter" || e.key===" "){ e.preventDefault(); go(); } };
    });
  }

  $("#mapLegend").innerHTML = groups.map(g=>{
    const c = "var("+PALETTE[g.picks[0].colorIdx % PALETTE.length]+")";
    return '<span><i class="swatch" style="background:color-mix(in srgb,'+c+' 20%,#fff);border-color:'+c+'"></i>'+esc(g.building.name)+'</span>';
  }).join("")
  + (showParking && parkingLocations?.length ? '<span><i class="swatch" style="background:var(--surface-3);border-color:var(--ink-muted)"></i>Parking</span>' : "");

  $("#mapCourseList").innerHTML = picks.length ? picks.map(p =>
    '<div class="crnrow"><div class="crntop">'
      + '<span class="crn-info"><b>'+esc(p.code)+'</b>'
      + (p.title?'<span class="crn-title">'+esc(p.title)+'</span>':"")
      + '<span class="crn-code">'+esc(shortType(p.scheduleType||""))+'</span>'
      + '<span class="crn-prof">'+esc(p.profName)+'</span></span>'
      + '<span class="crn-when" style="text-align:right">'+whereHTML(p)+'</span></div></div>'
  ).join("") : '<div class="empty">No sections added yet.</div>';
}

$("#parkingToggle").onchange = async () => {
  if($("#parkingToggle").checked && !parkingLocations){
    try {
      const r = await fetch("/api/campus-locations").then(r=>r.json());
      parkingLocations = r.parking || [];
    } catch(e) { parkingLocations = []; }
  }
  render();
};

(async () => {
  try {
    await ensureCatalog([...state.picked]);
  } catch(e) { /* render() still works with whatever loaded */ }
  render();
})();

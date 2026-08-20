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

let parkingLocations = null; // both fetched together, once, from the same /api/campus-locations call
let refBuildings = null;     // every non-parking campus point, drawn as small unlabeled dots so the map reads as real campus before any class is picked

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

/* Main campus's own footprint, in plain lat/lng -- 818 of the 887 scraped
   points (buildings and lots both) fall inside this box, the rest are
   satellite/off-campus properties out past El Paso. This is the floor
   the map always shows, so an empty schedule still renders real campus,
   not a blank panel -- see the "always show the map" note below. */
const DEFAULT_BOUNDS = { minLat: 31.7635, maxLat: 31.7835, minLng: -106.513, maxLng: -106.494 };

/* Widens DEFAULT_BOUNDS to also fit any real points being plotted, so a
   picked class at a building outside the usual core (a satellite site)
   still lands on-screen instead of getting clipped to the default. */
function unionBounds(points){
  let { minLat, maxLat, minLng, maxLng } = DEFAULT_BOUNDS;
  for(const p of points){
    minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng); maxLng = Math.max(maxLng, p.lng);
  }
  return { minLat, maxLat, minLng, maxLng };
}

/* lat/lng -> {x,y} in the 800x600 viewBox, fit to the given bounds with
   padding, preserving real relative distances (one shared scale for both
   axes, not stretched to fill the box) instead of distorting campus's
   actual shape. */
function projector(bounds){
  const { minLat, maxLat, minLng, maxLng } = bounds;
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

  /* The map itself always renders -- real campus, from DEFAULT_BOUNDS --
     whether or not anything's been added yet. Picked sections just add
     pins on top of that same base view instead of gating the map behind
     having a schedule at all. */
  const points = groups.map(g=>g.building).concat(showParking && parkingLocations ? parkingLocations : []);
  const project = projector(unionBounds(points));

  let svg = '<rect x="0" y="0" width="'+MAP_W+'" height="'+MAP_H+'" class="mapbg"></rect>';

  /* Plain reference dots for every building on file, drawn first (under
     everything else) so the page reads as a real map of campus even
     before any class is picked. A building already carrying a picked
     section gets its own bigger, labeled, colored pin below instead of
     also a plain dot underneath it. */
  if(refBuildings){
    svg += refBuildings.filter(b=>!byBuilding.has(b.id)).map(b=>{
      const {x,y} = project(b.lat, b.lng);
      return '<circle class="refpin" cx="'+x+'" cy="'+y+'" r="3"><title>'+esc(b.name)+'</title></circle>';
    }).join("");
  }

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
  ).join("") : '<div class="empty">'
    + (state.picked.size ? "No sections added yet. Choose a professor and CRN in Instructors to see it here." : "No courses added yet. Add one in Courses to see it here.")
    + '</div>';
}

$("#parkingToggle").onchange = render;

(async () => {
  render(); // draw the base map immediately, don't wait on any fetch
  try {
    const [locations] = await Promise.all([
      fetch("/api/campus-locations").then(r=>r.json()),
      ensureCatalog([...state.picked]),
    ]);
    refBuildings = locations.buildings || [];
    parkingLocations = locations.parking || [];
  } catch(e) { /* render() still works with whatever loaded */ }
  render();
})();

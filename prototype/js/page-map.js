/* =====================================================================
   MAP: pins at the buildings your added sections meet in, drawn over
   real OpenStreetMap raster tiles (tile.openstreetmap.org) -- standard
   public tile usage, the sanctioned way any site embeds a map, not a
   scrape of UTEP's own paid Concept3D map service. Concept3D's detailed
   campus view turned out not to be a static image at all: it's the same
   OSM building/street data, rendered live by MapboxGL through their own
   metered tileserver (tileserver.concept3d.com) -- reusing that directly
   would mean depending on another vendor's paid infrastructure, a real
   step up from the public, unauthenticated lat/lng points endpoint this
   project already relies on. Tiles are plotted with the standard Web
   Mercator slippy-map formula so pins line up exactly with real building
   footprints; the zoom level is chosen per view to fit whatever bounding
   box is being shown, the same "fit the visible points" idea the old
   flat-projection version used, just against real integer tile zooms
   instead of a continuous scale. No mapping library involved (this
   project has zero npm dependencies anywhere, see CLAUDE.md) -- tiles
   are plain SVG <image> elements inside the same coordinate space the
   pins already use, so the whole page is still one SVG element that
   scales responsively via its viewBox like before.
   ===================================================================== */
const MAP_W = 800, MAP_H = 600, PAD = 24;
const TILE = 256, MAX_ZOOM = 19, MIN_ZOOM = 12;

let parkingLocations = null; // fetched once on load, from /api/campus-locations

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
   Concept3D points (buildings and lots both) fall inside this box, the
   rest are satellite/off-campus properties out past El Paso. This is the
   floor every view fits at minimum, so an empty schedule still shows
   real main campus, not a blank panel. */
const DEFAULT_BOUNDS = { minLat: 31.7635, maxLat: 31.7835, minLng: -106.513, maxLng: -106.494 };

/* Widens DEFAULT_BOUNDS to also fit any real points being plotted, so a
   picked class at a building outside the usual core (a satellite site)
   still lands on-screen instead of getting clipped to the default. Once
   there's at least one real point, the view fits tightly to just those
   points (with a small margin) instead of also being floored to whole-
   campus DEFAULT_BOUNDS -- that floor is only for the truly-empty case,
   otherwise a single picked class would never zoom in past the
   whole-campus view, defeating the point of picking it. */
function computeBounds(points){
  if(!points.length) return { ...DEFAULT_BOUNDS };
  let minLat=Infinity, maxLat=-Infinity, minLng=Infinity, maxLng=-Infinity;
  for(const p of points){
    minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng); maxLng = Math.max(maxLng, p.lng);
  }
  const latPad = Math.max((maxLat-minLat)*0.2, 0.0018);
  const lngPad = Math.max((maxLng-minLng)*0.2, 0.0018);
  return { minLat: minLat-latPad, maxLat: maxLat+latPad, minLng: minLng-lngPad, maxLng: maxLng+lngPad };
}

/* Standard Web Mercator lng/lat -> world pixel at a given integer zoom
   (256px tiles, the same formula every slippy-map tile server uses). */
function worldX(lng, z){ return (lng+180)/360 * TILE * Math.pow(2,z); }
function worldY(lat, z){
  const r = lat * Math.PI/180;
  return (1 - Math.log(Math.tan(r) + 1/Math.cos(r)) / Math.PI) / 2 * TILE * Math.pow(2,z);
}

/* Picks the largest integer zoom where `bounds` still fits inside the
   padded viewBox (the tile equivalent of the old projector's "fit to
   scale"), then returns a lat/lng -> {x,y} projector at that zoom plus
   the zoom itself, so the tile grid and the pins share one coordinate
   space exactly. */
function computeView(bounds){
  const availW = MAP_W - PAD*2, availH = MAP_H - PAD*2;
  let zoom = MAX_ZOOM;
  for(; zoom > MIN_ZOOM; zoom--){
    const w = worldX(bounds.maxLng, zoom) - worldX(bounds.minLng, zoom);
    const h = worldY(bounds.minLat, zoom) - worldY(bounds.maxLat, zoom);
    if(w <= availW && h <= availH) break;
  }
  const wx0 = worldX(bounds.minLng, zoom), wx1 = worldX(bounds.maxLng, zoom);
  const wy0 = worldY(bounds.maxLat, zoom), wy1 = worldY(bounds.minLat, zoom);
  const offX = wx0 - (availW-(wx1-wx0))/2 - PAD;
  const offY = wy0 - (availH-(wy1-wy0))/2 - PAD;
  return {
    zoom, offX, offY,
    project: (lat,lng) => ({ x: worldX(lng,zoom)-offX, y: worldY(lat,zoom)-offY }),
  };
}

/* SVG <image> tiles covering the visible MAP_W x MAP_H area at the
   view's zoom -- see https://operations.osmfoundation.org/policies/tiles/
   for OSM's tile usage policy this stays within (plain browser-rendered
   <img>-equivalents, standard attribution below the map, no bulk/
   automated fetching). Longitude wraps around the world; latitude tiles
   outside the valid 0..2^zoom-1 range (past the poles) are skipped. */
function tileLayerSVG(view){
  const { zoom, offX, offY } = view;
  const n = Math.pow(2, zoom);
  const x0 = Math.floor(offX / TILE), x1 = Math.floor((offX+MAP_W) / TILE);
  const y0 = Math.floor(offY / TILE), y1 = Math.floor((offY+MAP_H) / TILE);
  let html = "";
  for(let ty=y0; ty<=y1; ty++){
    if(ty < 0 || ty >= n) continue;
    for(let tx=x0; tx<=x1; tx++){
      const wx = ((tx % n) + n) % n;
      html += '<image href="https://tile.openstreetmap.org/'+zoom+'/'+wx+'/'+ty+'.png" '
        + 'x="'+(tx*TILE-offX)+'" y="'+(ty*TILE-offY)+'" width="'+TILE+'" height="'+TILE+'"></image>';
    }
  }
  return html;
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
  const view = computeView(computeBounds(points));
  const project = view.project;

  let svg = tileLayerSVG(view);

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
    + 'aria-label="Map of UTEP campus with pins at your added classes\' buildings">'+svg+'</svg>'
    + '<div class="maptileattr">&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors</div>';

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
    parkingLocations = locations.parking || [];
  } catch(e) { /* render() still works with whatever loaded */ }
  render();
})();

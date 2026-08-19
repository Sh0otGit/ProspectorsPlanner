/* =====================================================================
   SHARED: state, formatting utilities, scoring, and the chrome
   (progress nav, breadcrumbs, action bar) rendered on every step page.
   Requires js/data.js to be loaded first for CATALOG.

   State lives in sessionStorage, not localStorage: it is scoped to
   the tab and clears on close. Only the student's own choices (picked
   courses, blocked hours, added sections) are stored here, never the
   degree evaluation file or its parsed text. See CLAUDE.md, "The
   degree evaluation must be parsed client-side."
   ===================================================================== */

const SCREENS = ["index.html","upload.html","courses.html","availability.html","instructors.html","schedule.html"];
const STEP_LABELS = ["Start","Evaluation","Courses","Availability","Instructors","Schedule"];
const DAYS = ["M","T","W","R","F","S"];
const DAY_NAMES = {M:"Mon",T:"Tue",W:"Wed",R:"Thu",F:"Fri",S:"Sat"};
const START_H = 6, END_H = 21, SLOT_MIN = 30;
const SS_KEY = "prospectors_planner_ui_state_v1";

const $  = (s,r=document)=>r.querySelector(s);
const $$ = (s,r=document)=>[...r.querySelectorAll(s)];

/* ---------- escaping ----------
   Fabricated data never needs this, but real scraped/parsed names,
   titles and reviews will flow through these same innerHTML templates
   once Build order phases 3 to 4 land (see CLAUDE.md). Escape any
   string that could plausibly come from outside this file. */
function esc(s){
  return String(s).replace(/[&<>"']/g, c => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  }[c]));
}

/* ---------- state ---------- */
function loadState(){
  let d = {};
  try { d = JSON.parse(sessionStorage.getItem(SS_KEY)) || {}; } catch(e){}
  return {
    parsed: !!d.parsed,
    picked: new Set(d.picked || []),
    blocked: new Set(d.blocked || []),
    chosen: new Map(Object.entries(d.chosen || {})),
    activeCourse: d.activeCourse || null,
    visited: new Set(d.visited && d.visited.length ? d.visited : [0]),
    revOpen: new Set(d.revOpen || []),
    revPage: d.revPage || {}
  };
}
function saveState(){
  sessionStorage.setItem(SS_KEY, JSON.stringify({
    parsed: state.parsed,
    picked: [...state.picked],
    blocked: [...state.blocked],
    chosen: Object.fromEntries(state.chosen),
    activeCourse: state.activeCourse,
    visited: [...state.visited],
    revOpen: [...state.revOpen],
    revPage: state.revPage
  }));
}
function resetState(){
  sessionStorage.removeItem(SS_KEY);
}

const state = loadState();

/* chosen course -> {profName, crn}. Resolve the live section object from
   CATALOG rather than storing it, so data.js stays the single source. */
function getChosenSection(code){
  const c = state.chosen.get(code);
  if(!c) return null;
  const p = (CATALOG[code]||[]).find(x=>x.name===c.profName);
  return p ? p.sections.find(s=>s.crn===c.crn) : null;
}

/* Steps 2 to 5 are freely navigable once the evaluation is parsed.
   Instructors and Schedule additionally need at least one schedulable course. */
function activeCodes(){ return [...state.picked].filter(c=>CATALOG[c]); }
function stepReachable(i){
  if(i<=1) return true;
  if(!state.parsed) return false;
  if(i<=3) return true;
  return activeCodes().length>0;
}
function seedDemo(){
  state.parsed = true;
  ["CS 3350","CS 3432","CS 4311","MATH 3323","ENGL 3359"].forEach(c=>state.picked.add(c));
  saveState();
}

/* ---------- formatting ---------- */
const SLOTS = (()=>{ const o=[]; for(let m=START_H*60;m<END_H*60;m+=SLOT_MIN) o.push(m); return o; })();
const toMin = t => t ? (+t.slice(0,2))*60 + (+t.slice(3,5)) : null;
/* Style guide: no excess zeros ("9 a.m."), lowercase a.m./p.m.,
   and "noon"/"midnight" instead of 12 p.m. / 12 a.m. */
const fmt = t => {
  if(!t) return "";
  const H=+t.slice(0,2), m=t.slice(3,5);
  if(H===12 && m==="00") return "noon";
  if(H===0  && m==="00") return "midnight";
  const ap = H>=12 ? "p.m." : "a.m.";
  const h = H%12 || 12;
  return (m==="00" ? String(h) : h+":"+m) + " " + ap;
};

/* Style guide: spell out one through nine, numerals for 10 and up. */
const NUMWORD=["zero","one","two","three","four","five","six","seven","eight","nine"];
const num    = n => n<10 ? NUMWORD[n] : String(n);
const numCap = n => { const w=num(n); return w[0].toUpperCase()+w.slice(1); };
const slotIdx = min => Math.floor((min - START_H*60)/SLOT_MIN);

function sectionSlots(sec){
  if(!sec.days.length || sec.start==null) return [];
  const a=slotIdx(toMin(sec.start)), b=Math.ceil((toMin(sec.end)-START_H*60)/SLOT_MIN);
  const out=[];
  for(const d of sec.days) for(let i=a;i<b;i++) out.push(d+"-"+i);
  return out;
}
const hitsBlocked = sec => sectionSlots(sec).some(k=>state.blocked.has(k));
function occupiedSlots(exceptCode){
  const s=new Set();
  for(const code of state.chosen.keys()){
    if(code===exceptCode) continue;
    const sec = getChosenSection(code);
    if(sec) sectionSlots(sec).forEach(k=>s.add(k));
  }
  return s;
}
const hitsEnrolled = (sec,code) => {
  const occ=occupiedSlots(code);
  return sectionSlots(sec).some(k=>occ.has(k));
};

/* Number of other added courses whose section overlaps this one's. */
function conflictCount(code){
  const sec = getChosenSection(code);
  if(!sec) return 0;
  const mine = new Set(sectionSlots(sec));
  let n = 0;
  for(const other of state.chosen.keys()){
    if(other===code) continue;
    const otherSec = getChosenSection(other);
    if(otherSec && sectionSlots(otherSec).some(k=>mine.has(k))) n++;
  }
  return n;
}

function combined(p){
  const hasE = p.evalAdj!=null, hasR = !!p.rmp;
  if(!hasE && !hasR) return null;
  if(!hasE) return p.rmp.score;
  if(!hasR) return p.evalAdj;
  return W_EVAL*p.evalAdj + W_RMP*p.rmp.score;
}
function starsHTML(v){
  const pct = v==null ? 0 : Math.max(0,Math.min(100, v/5*100));
  return '<span class="starwrap" role="img" aria-label="'+(v==null?"no rating":v.toFixed(2)+" out of 5")+'">'
       + '<span class="starbase">&#9733;&#9733;&#9733;&#9733;&#9733;</span>'
       + '<span class="starfill" style="width:'+pct+'%">&#9733;&#9733;&#9733;&#9733;&#9733;</span></span>';
}
const qColor = q => "var(--r"+Math.max(1,Math.min(5,q))+")";

/* Real slots start at START_H (6 a.m.) so the two half-hours before 7 a.m.
   are genuine, clickable slots, not dead space. Their hour label is just
   suppressed below LABEL_FROM_H so the grid still reads as starting at
   7 a.m., matching the buffer that already exists below the last labeled
   hour (the hour label is nudged up 7px to align with its gridline; a
   labeled first row would poke that nudge past the table's top border). */
const LABEL_FROM_H = 7;
function calSkeleton(id, cellFn){
  let h = "<thead><tr><th></th>" + DAYS.map(d=>'<th data-day="'+d+'">'+DAY_NAMES[d]+"</th>").join("") + "</tr></thead><tbody>";
  SLOTS.forEach((m,i)=>{
    const label = (m%60===0 && m>=LABEL_FROM_H*60) ? fmt(String(Math.floor(m/60)).padStart(2,"0")+":00") : "";
    h += '<tr><td class="t">'+label+"</td>" + DAYS.map(d=>cellFn(d,i)).join("") + "</tr>";
  });
  $(id).innerHTML = h + "</tbody>";
}

/* ---------- chrome: progress nav, breadcrumbs, action bar ----------
   Each step page sets window.CURRENT_STEP (1 to 5) before this script
   runs. Landing (index.html) leaves it unset and carries no chrome. */
function renderChrome(){
  const n = window.CURRENT_STEP;
  if(n==null) return;

  state.visited.add(n);
  saveState();

  $("#sectionnavInner").innerHTML = STEP_LABELS.map((l,i)=>{
    let cls;
    if(i===n)                     cls = "item active";
    else if(!stepReachable(i))    cls = "item locked";
    else if(state.visited.has(i)) cls = "item done";
    else                          cls = "item avail";
    /* Start (i===0) isn't part of the numbered 1-5 sequence used in the
       "Step X of 5" copy on each page, so its badge stays blank. */
    const mark = i===0 ? "" : i;
    return '<button class="'+cls+'" data-step="'+i+'"'+(cls==="item locked"?" disabled":"")
         + '><span class="n">'+mark+'</span>'+l+'</button>';
  }).join("");
  $$(".item.done,.item.avail").forEach(el=>el.onclick=()=>{ location.href = SCREENS[+el.dataset.step]; });

  $("#backBtn").style.visibility = n<=1 ? "hidden" : "visible";
  $("#backBtn").onclick = ()=>{ location.href = SCREENS[n-1]; };

  const skip=$("#skipBtn"), next=$("#nextBtn"), hint=$("#navHint");
  skip.style.display = n===3 ? "" : "none";
  skip.onclick = ()=>{ location.href = SCREENS[4]; };

  /* Step 1 carries its own Continue button inside the result panel.
     Step 5 is the last step: nothing to continue to. */
  next.style.display = (n===1 || n===5) ? "none" : "";
  next.onclick = ()=>{ location.href = SCREENS[n+1]; };

  if(n===2){
    const c=state.picked.size; next.disabled=c===0; next.textContent="Continue";
    hint.textContent = c ? numCap(c)+" course"+(c>1?"s":"")+" selected" : "Select at least one course";
  } else if(n===3){
    next.disabled=false; next.textContent="Continue";
    hint.textContent = state.blocked.size ? numCap(state.blocked.size)+" half-hour blocks marked" : "No hours blocked";
  } else if(n===4){
    const c=state.chosen.size, t=activeCodes().length;
    next.disabled=c===0; next.textContent="View schedule";
    hint.textContent = numCap(c)+" of "+num(t)+" courses scheduled";
  } else if(n===5){
    hint.textContent = "Copy your CRNs into Goldmine when your registration window opens.";
  } else {
    hint.textContent = "";
  }
}

$("#restartBtn").onclick = ()=>{
  resetState();
  location.href = "index.html";
};

renderChrome();

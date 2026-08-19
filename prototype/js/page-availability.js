/* =====================================================================
   STEP 3: block out hours the student cannot attend. Mouse-drag only;
   touch is not wired (see CLAUDE.md, Build order phase 5).
   ===================================================================== */
let dragging=false, dragMode=null;

function renderBlockCal(){
  calSkeleton("#blockCal",(d,i)=>{
    const k=d+"-"+i;
    return '<td class="'+(state.blocked.has(k)?"blocked":"")+'" data-k="'+k+'"></td>';
  });
  $$("#blockCal td[data-k]").forEach(td=>{
    td.onmousedown = e => { e.preventDefault(); dragging=true; dragMode = !state.blocked.has(td.dataset.k); paint(td); };
    td.onmouseenter = () => { if(dragging) paint(td); };
  });
  $$("#blockCal thead th[data-day]").forEach(th=>{
    th.classList.add("clickable-day");
    th.onclick = () => toggleDay(th.dataset.day);
  });
  updBlockCount();
}
function toggleDay(d){
  const allBlocked = SLOTS.every((m,i)=>state.blocked.has(d+"-"+i));
  SLOTS.forEach((m,i)=>{
    const k = d+"-"+i;
    if(allBlocked) state.blocked.delete(k); else state.blocked.add(k);
  });
  saveState();
  renderBlockCal(); renderChrome();
}
function paint(td){
  const k=td.dataset.k;
  if(dragMode){ state.blocked.add(k); td.classList.add("blocked"); }
  else { state.blocked.delete(k); td.classList.remove("blocked"); }
  saveState();
  updBlockCount(); renderChrome();
}
document.addEventListener("mouseup",()=>dragging=false);
function updBlockCount(){
  const n=state.blocked.size;
  $("#blockCount").textContent = n
    ? numCap(n)+" half-hour blocks marked unavailable"
    : "No hours blocked. Drag across the grid, or skip this step.";
}

$("#clearBlocks").onclick = ()=>{ state.blocked.clear(); saveState(); renderBlockCal(); renderChrome(); };

renderBlockCal();

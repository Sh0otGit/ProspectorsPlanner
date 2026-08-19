/* =====================================================================
   STEP 1: upload / parse. The drop zone accepts a file but always loads
   the sample; no HTML/PDF parser is built yet (see CLAUDE.md, Build
   order phase 4).
   ===================================================================== */
function parseDemo(){
  state.parsed = true;
  saveState();
  const pct = Math.round(STUDENT.earned/STUDENT.required*100);
  $("#parseOut").innerHTML =
   '<div class="panel"><div class="phead">Result</div><div class="pad">'
   + '<div class="kv">'
   + '<div><div class="k">Student</div><b>'+esc(STUDENT.name)+'</b></div>'
   + '<div><div class="k">Program</div><b>'+esc(STUDENT.program)+'</b></div>'
   + '<div><div class="k">Catalog year</div><b>'+esc(STUDENT.catalog)+'</b></div>'
   + '<div><div class="k">Hours earned</div><b>'+STUDENT.earned+' of '+STUDENT.required+'</b></div>'
   + '</div>'
   + '<div class="progress"><i style="width:'+pct+'%"></i></div>'
   + '<div style="font-size:12.5px;color:var(--ink-muted);margin-top:6px">'
   + pct+'% complete. '+(STUDENT.required-STUDENT.earned)+' hours remaining.</div>'
   + '<div class="resultfoot">'
   + '<button class="btn primary" id="parseContinue">Continue</button>'
   + '<span style="font-size:13px;color:var(--ink-muted)">Nine unmet requirements</span>'
   + '</div>'
   + '</div></div>';
  $("#parseContinue").onclick = ()=>{ location.href = "courses.html"; };
  renderChrome();
}

$("#demoBtn").onclick = e => { e.stopPropagation(); parseDemo(); };
$("#drop").onclick = parseDemo;
$("#drop").addEventListener("dragover",e=>{e.preventDefault();$("#drop").classList.add("hot")});
$("#drop").addEventListener("dragleave",()=>$("#drop").classList.remove("hot"));
$("#drop").addEventListener("drop",e=>{e.preventDefault();$("#drop").classList.remove("hot");parseDemo()});

if(state.parsed) parseDemo();

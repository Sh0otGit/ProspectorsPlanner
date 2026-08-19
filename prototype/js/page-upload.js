/* =====================================================================
   STEP 1: upload / parse. The drop zone accepts a file, but there is no
   real parser yet -- the degree evaluation parser is deliberately last in
   the build order (see CLAUDE.md, Build order phase 4), specifically so
   it has real course codes to validate against, which is what the rest of
   this build (real course search, real instructor data) now provides.
   This step is honest about that instead of pretending to extract
   requirements from whatever file gets dropped: it acknowledges the step
   and sends you on to search real UTEP courses directly.
   ===================================================================== */
function continueToCourses(){
  state.parsed = true;
  saveState();
  $("#parseOut").innerHTML =
   '<div class="notice"><b>Requirement parsing isn\'t built yet.</b> '
   + 'This step will read your unmet requirements straight from the file once that\'s in place. '
   + 'For now, search for the courses you still need on the next step.</div>'
   + '<div class="resultfoot">'
   + '<button class="btn primary" id="parseContinue">Continue to course search</button>'
   + '</div>';
  $("#parseContinue").onclick = ()=>{ location.href = "courses.html"; };
  renderChrome();
}

$("#demoBtn").onclick = e => { e.stopPropagation(); continueToCourses(); };
$("#drop").onclick = continueToCourses;
$("#drop").addEventListener("dragover",e=>{e.preventDefault();$("#drop").classList.add("hot")});
$("#drop").addEventListener("dragleave",()=>$("#drop").classList.remove("hot"));
$("#drop").addEventListener("drop",e=>{e.preventDefault();$("#drop").classList.remove("hot");continueToCourses()});

if(state.parsed) continueToCourses();

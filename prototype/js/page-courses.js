/* =====================================================================
   STEP 2: pick unmet requirements.
   ===================================================================== */
function renderCourses(){
  const allItems = REQS.flatMap(g=>g.items);
  const selHours = [...state.picked].reduce((a,c)=>{
    const it = allItems.find(i=>i.code===c); return a + (it?it.cr:0);
  },0);
  const remaining = STUDENT.required - STUDENT.earned;

  $("#statbar").innerHTML =
    '<div><div class="lab">Hours earned</div><div class="val">'+STUDENT.earned+'</div><div class="sub">of '+STUDENT.required+' required</div></div>'
  + '<div><div class="lab">Hours remaining</div><div class="val">'+remaining+'</div><div class="sub">about '+Math.ceil(remaining/15)+' more semesters</div></div>'
  + '<div><div class="lab">Unmet requirements</div><div class="val">'+allItems.length+'</div><div class="sub">one needs a selection</div></div>'
  + '<div><div class="lab">Selected</div><div class="val">'+selHours+'</div><div class="sub">hours in '+esc(STUDENT.term)+'</div></div>';

  $("#reqlist").innerHTML = REQS.map(g=>
    '<table class="req"><caption>'+esc(g.group)+'</caption>'
    + '<thead><tr><th></th><th>Course</th><th>Title</th><th style="text-align:right">Hours</th></tr></thead><tbody>'
    + g.items.map(it=>{
        const sel = state.picked.has(it.code);
        const noData = !CATALOG[it.code];
        const cls = it.flag ? "off" : ("pick"+(sel?" sel":""));
        return '<tr class="'+cls+'" data-code="'+esc(it.code)+'">'
          + '<td class="chk"><input type="checkbox" '+(sel?"checked":"")+' '+(it.flag?"disabled":"")+'></td>'
          + '<td class="code">'+esc(it.code)+'</td>'
          + '<td>'+esc(it.title)+(it.flag?'<span class="tagflag">'+esc(it.flag)+'</span>':'')
            + (it.note?'<span class="subnote">'+esc(it.note)+'</span>':'')
            + (!it.flag && noData?'<span class="subnote">No sections offered in '+esc(STUDENT.term)+'</span>':'')
          + '</td><td class="cr">'+it.cr+'</td></tr>';
      }).join("")
    + '</tbody></table>').join("");

  $$("table.req tr.pick").forEach(row=>{
    const box = $("input",row);
    row.onclick = e => {
      if(e.target.tagName!=="INPUT") box.checked = !box.checked;
      const c=row.dataset.code;
      if(box.checked) state.picked.add(c);
      else { state.picked.delete(c); state.chosen.delete(c); if(state.activeCourse===c) state.activeCourse=null; }
      saveState();
      renderCourses(); renderChrome();
    };
  });
}

renderCourses();

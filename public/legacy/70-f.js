(function(){
  let regionMode=false,selecting=false,moving=false,movedAwaitingOutsideClick=false,start={x:0,y:0},moveStart={x:0,y:0},selected=[],snapshot=[],lastMovedBounds=null;const EPS=2;
  const shell=()=>document.getElementById('editor-page-shell'),layer=()=>document.getElementById('editor-text-layer');
  function ensureUi(){const b=document.getElementById('region-mode-btn');if(!b||b._bound)return;b._bound=true;b.onclick=()=>{if(regionMode){clearSelection()}else{selected.forEach(x=>x.el.classList.remove('region-selected'));selected=[];regionMode=true;updateUi()}};updateUi()}
  function updateUi(){const sh=shell();if(sh)sh.style.touchAction=(regionMode||selected.length)?'none':'';const b=document.getElementById('region-mode-btn'),s=document.getElementById('region-status');if(b){b.textContent=regionMode?'✖ Bỏ Chọn Vùng':'▣ Chọn Vùng';b.classList.toggle('active',regionMode);b.setAttribute('aria-pressed',regionMode?'true':'false')}if(s)s.textContent=selected.length?'Đã chọn '+selected.length+' đối tượng':regionMode?'Kéo chuột để tạo khung chọn':'Chưa chọn đối tượng'}
  function rectOf(el,root){const a=el.getBoundingClientRect(),b=root.getBoundingClientRect();return{left:a.left-b.left,top:a.top-b.top,right:a.right-b.left,bottom:a.bottom-b.top,width:a.width,height:a.height}}
  function intersects(a,b){return a.right>=b.left-EPS&&a.left<=b.right+EPS&&a.bottom>=b.top-EPS&&a.top<=b.bottom+EPS}
  function objects(){const l=layer();return l?Array.from(l.querySelectorAll('span:not(.original-mask),.editor-img-box')).filter(el=>el.offsetWidth>0&&el.offsetHeight>0):[]}
  function clearSelection(){selected.forEach(x=>{if(x.el&&x.el.classList)x.el.classList.remove('region-selected')});selected=[];moving=false;selecting=false;regionMode=false;movedAwaitingOutsideClick=false;lastMovedBounds=null;start={x:0,y:0};snapshot=[];document.body.style.userSelect='';const box=document.getElementById('region-select-box');if(box){box.style.display='none';box.style.left='0px';box.style.top='0px';box.style.width='0px';box.style.height='0px';}const btn=document.getElementById('region-mode-btn');if(btn){btn.textContent='▣ Chọn Vùng';btn.classList.remove('active');btn.setAttribute('aria-pressed','false')}updateUi()}
  function point(e){const r=shell().getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top}}
  function startSelect(e){if(!regionMode||e.button!==0||!shell()||!layer()||e.target.closest('.editing-input'))return;e.preventDefault();selecting=true;start=point(e);let box=document.getElementById('region-select-box');if(!box){box=document.createElement('div');box.id='region-select-box';box.className='region-select-box';shell().appendChild(box)}Object.assign(box.style,{left:start.x+'px',top:start.y+'px',width:'0px',height:'0px',display:'block'})}
  function moveSelect(e){if(!selecting)return;const p=point(e),box=document.getElementById('region-select-box');Object.assign(box.style,{left:Math.min(start.x,p.x)+'px',top:Math.min(start.y,p.y)+'px',width:Math.abs(p.x-start.x)+'px',height:Math.abs(p.y-start.y)+'px'})}
  function endSelect(e){
    if(!selecting)return;
    selecting=false;
    const p=point(e),area={left:Math.min(start.x,p.x),top:Math.min(start.y,p.y),right:Math.max(start.x,p.x),bottom:Math.max(start.y,p.y)};
    selected=objects().map(el=>({el,rect:rectOf(el,shell())})).filter(x=>intersects(x.rect,area));
    const box=document.getElementById('region-select-box');
    if(box){box.style.display='none';box.style.left='0px';box.style.top='0px';box.style.width='0px';box.style.height='0px';}
    selected.forEach(x=>x.el.classList.add('region-selected'));
    // Giữ chế độ chọn vùng bật sau khi thả chuột: nút vẫn là '✖ Bỏ Chọn Vùng'.
    // Người dùng tự nhấn '✖ Bỏ Chọn Vùng' để xóa lựa chọn và reset khung về mặc định.
    regionMode=true;
    start={x:0,y:0};
    updateUi();
  }
  function beginMove(e){if(!selected.length||e.button!==0||!selected.some(x=>x.el===e.target||x.el.contains(e.target)))return;e.preventDefault();moving=true;moveStart={x:e.clientX,y:e.clientY};snapshot=selected.map(x=>({el:x.el,left:parseFloat(x.el.style.left)||0,top:parseFloat(x.el.style.top)||0}));document.body.style.userSelect='none'}
  function moveGroup(e){if(!moving)return;const dx=e.clientX-moveStart.x,dy=e.clientY-moveStart.y;snapshot.forEach(x=>{x.el.style.left=x.left+dx+'px';x.el.style.top=x.top+dy+'px'})}
  function endMove(){if(!moving)return;moving=false;movedAwaitingOutsideClick=true;document.body.style.userSelect='';lastMovedBounds=null;if(selected.length){const rs=selected.map(x=>x.el&&x.el.getBoundingClientRect?x.el.getBoundingClientRect():null).filter(r=>r&&r.width>=0&&r.height>=0);if(rs.length)lastMovedBounds={left:Math.min(...rs.map(r=>r.left))-4,top:Math.min(...rs.map(r=>r.top))-4,right:Math.max(...rs.map(r=>r.right))+4,bottom:Math.max(...rs.map(r=>r.bottom))+4};}selected.forEach(x=>{const el=x.el;if(el&&el.matches&&el.matches('span')&&el._item&&window.editorViewport&&window.savePositionAndText){const idx=Number(el.dataset.tidx),left=parseFloat(el.style.left)||0,top=parseFloat(el.style.top)||0,size=el._ptSize||el._item.height;try{savePositionAndText(el,el._item,idx,[0,0,0,0,left,top+size*(window.editorScale||1)])}catch(_){}}});if(window.recordHistory)try{recordHistory()}catch(_){}}
  function pointInsideSelectedBounds(e){let b=lastMovedBounds;if(!b&&selected.length){const rs=selected.map(x=>x.el&&x.el.getBoundingClientRect?x.el.getBoundingClientRect():null).filter(r=>r&&r.width>=0&&r.height>=0);if(rs.length)b={left:Math.min(...rs.map(r=>r.left))-4,top:Math.min(...rs.map(r=>r.top))-4,right:Math.max(...rs.map(r=>r.right))+4,bottom:Math.max(...rs.map(r=>r.bottom))+4};}return !!b&&e.clientX>=b.left&&e.clientX<=b.right&&e.clientY>=b.top&&e.clientY<=b.bottom;}
  document.addEventListener('DOMContentLoaded',()=>{ensureUi();new MutationObserver(ensureUi).observe(document.getElementById('tab-editor')||document.body,{childList:true,subtree:true});document.addEventListener('keydown',e=>{if(e.key==='Escape')clearSelection()});
    // Bắt click ở capture phase để reset trước khi các handler chọn/kéo khác nhận sự kiện.
    document.addEventListener('pointerdown',e=>{if(movedAwaitingOutsideClick&&!moving&&!pointInsideSelectedBounds(e)){clearSelection();const btn=document.getElementById('region-mode-btn');if(btn){btn.textContent='▣ Chọn Vùng';btn.classList.remove('active');btn.setAttribute('aria-pressed','false')}e.stopImmediatePropagation();e.preventDefault();}},true);
    document.addEventListener('pointerdown',e=>{if(e.target.closest&&e.target.closest('#editor-page-shell')){startSelect(e);beginMove(e)} });document.addEventListener('pointermove',e=>{moveSelect(e);moveGroup(e)});document.addEventListener('pointerup',e=>{endSelect(e);endMove()});document.addEventListener('pointercancel',e=>{endSelect(e);endMove()})});
  const oldSwitch=window.switchTab;window.switchTab=function(){const r=oldSwitch.apply(this,arguments);setTimeout(ensureUi,0);return r};
})();

'use strict';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const clone = x => JSON.parse(JSON.stringify(x));
const uid = () => Math.random().toString(36).slice(2,10);
const esc = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const fmtDate=s=>{try{return new Date(s).toLocaleDateString('en-CA',{month:'short',day:'numeric'})}catch{return s||''}};
const fmtTime=s=>{const n=Math.max(0,Math.floor(s||0));return String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0')};

async function api(method,path,body){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),12000);
  const opt={method,headers:{},signal:controller.signal};
  if(body!==undefined){opt.headers['Content-Type']='application/json';opt.body=JSON.stringify(body)}
  try{
    const r=await fetch(path,opt); const t=await r.text(); let o={}; try{o=t?JSON.parse(t):{}}catch{o={error:t}}
    if(!r.ok) throw new Error(o.error||('HTTP '+r.status)); return o;
  }catch(e){
    if(e?.name==='AbortError') throw new Error('VanoNote server did not respond. Restart VanoNote and try again.');
    throw e;
  }finally{clearTimeout(timer)}
}
function toast(msg){const e=$('#toast');e.textContent=msg;e.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>e.classList.remove('show'),2200)}
function modal(html){$('#modal').innerHTML=html;$('#modalOverlay').classList.remove('hidden')}
function closeModal(){$('#modalOverlay').classList.add('hidden')}
function setCoreBusy(on,msg='Working…'){
  document.body.classList.toggle('coreBusy',!!on);
  const b=$('#coreBusy'); if(b){b.classList.toggle('hidden',!on);b.textContent=msg;}
}
function notePayload(n){return {title:n.title,folder_id:n.folder_id,paper:n.paper,favorite:n.favorite,plain_text:n.plain_text||'',transcript:n.transcript||'',tags:n.tags||'',content:clone(n.content)};}
async function saveSnapshot(n){if(!n||sharedMode==='view')return;try{const r=await api('PUT','/api/notes/'+n.id,notePayload(n));n.revision=r.revision;n.updated_at=r.updated_at;return r}catch(e){console.warn('Background save failed',e);toast('Save warning: '+e.message)}}
$('#modalOverlay').addEventListener('mousedown',e=>{if(e.target.id==='modalOverlay')closeModal()});

const COLORS=['#17211b','#1f4e37','#8c3b24','#c9881e','#245c9b','#7d4ca3','#e85b8f','#ffffff'];
let S={folders:[],notes:[],fitz:false,lan:'localhost',port:8766};
let NOTE=null, FILTER='all', FOLDER=null, LISTGRID=false, SORT='updated';
let TOOL='pen', COLOR=COLORS[0], SIZE=4, ZOOM=.56, PAGE=0;
let undoStack=[],redoStack=[],activeStroke=null,draftShape=null,selection=null,dragSelection=null,laserStroke=null;
let saveTimer=null, saveInFlight=false, pendingSave=false, creatingNote=false;
let imgCache=new Map();
let mediaRecorder=null, mediaChunks=[],recordStart=0,recordTick=null,audioStream=null;
let recognition=null,transcribing=false,sharedToken=null,sharedMode=null,sharedPoll=null;
let penSeenAt=0;

const PEN_DEFAULTS={smoothing:'medium',strokeCorrection:true,pressureCurve:'linear',trackpadPinch:true};
function loadPenConfig(){try{return {...PEN_DEFAULTS,...JSON.parse(localStorage.getItem('vn_pen_config')||'{}')}}catch{return {...PEN_DEFAULTS}}}
let PENCFG=loadPenConfig();
let overlayRAF=0,safariGestureStartZoom=null;

const canvas=$('#inkCanvas'), overlay=$('#overlayCanvas'), stage=$('#pageStage');
const ctx=canvas.getContext('2d',{desynchronized:true}), octx=overlay.getContext('2d',{desynchronized:true});
ctx.imageSmoothingEnabled=true;octx.imageSmoothingEnabled=true;

function defaultContent(paper='blank'){
  return {version:1,activePage:0,paper,pages:[{id:uid(),name:'Page 1',paper,width:1600,height:2200,strokes:[],objects:[],background:null}],settings:{penOnly:true,snap:false}};
}
function page(){return NOTE?.content?.pages?.[PAGE]||null}
function folderName(id){return S.folders.find(f=>f.id==id)?.name||''}
function currentEndpoint(){return sharedToken?'/api/shared/'+sharedToken:'/api/notes/'+NOTE.id}

async function boot(){
  const p=location.pathname.match(/^\/s\/([^/]+)$/); if(p){sharedToken=p[1];await loadShared();return}
  S=await api('GET','/api/bootstrap');
  renderLibrary(); renderList(); bindUI(); applyTheme(localStorage.getItem('vn_theme')||'autumn'); setTool('pen'); setColor(COLOR); setSize(SIZE);
  const q=new URLSearchParams(location.search); if(q.get('note')) selectNote(+q.get('note'));
}

async function loadShared(){
  try{NOTE=await api('GET','/api/shared/'+sharedToken);sharedMode=NOTE.shared_mode;document.body.classList.add('presentation');$('#library').classList.add('hidden');$('#noteListPane').classList.add('hidden');$('#topbar').classList.add('hidden');$('#editor').classList.remove('hidden');$('#emptyState').classList.add('hidden');$('#classbar').classList.remove('hidden');$('#classInfo').textContent=sharedMode==='edit'?'Collaborative whiteboard — student':'Student view — read only';NOTE.content=NOTE.content||defaultContent();PAGE=NOTE.content.activePage||0;bindUI();hydrateEditor();if(sharedMode!=='edit') $('#classbar').querySelector('b').textContent='STUDENT VIEW';startSharedPolling();}catch(e){document.body.innerHTML='<div style="padding:40px;font-family:sans-serif">Invalid or disabled VanoNote link.</div>'}
}
function startSharedPolling(){clearInterval(sharedPoll);sharedPoll=setInterval(async()=>{if(!NOTE||saveInFlight)return;try{const n=await api('GET','/api/shared/'+sharedToken);if(n.revision>NOTE.revision){NOTE=n;NOTE.content=NOTE.content||defaultContent();PAGE=clamp(PAGE,0,NOTE.content.pages.length-1);hydrateEditor(false)}}catch{}},900)}

function bindUI(){
  if(bindUI.done)return;bindUI.done=true;
  $('#libToggle').onclick=()=>{if(NOTE&&innerWidth>850){document.body.classList.toggle('noteFocus')}else document.body.classList.toggle('libopen')};
  $('#newNote').onclick=()=>App.newNote(); $('#newFolder').onclick=newFolder;
  $('#search').oninput=()=>renderList(); $('#gridBtn').onclick=()=>{LISTGRID=!LISTGRID;renderList()};
  $('#sortBtn').onclick=()=>{SORT=SORT==='updated'?'title':'updated';renderList()};
  $$('.navitem').forEach(b=>b.onclick=()=>{$$('.navitem,.folder').forEach(x=>x.classList.remove('on'));b.classList.add('on');FILTER=b.dataset.filter;FOLDER=null;$('#listTitle').textContent=b.textContent.trim().replace(/\d+$/,'');renderList()});
  $('#noteTitle').oninput=e=>{if(!NOTE||sharedMode==='view')return;NOTE.title=e.target.value;scheduleSave();updateMetaTitle()};
  $('#noteTitle').onblur=()=>saveNow();
  $$('.tool').forEach(b=>b.onclick=()=>setTool(b.dataset.tool));
  $('#customColor').oninput=e=>setColor(e.target.value); $('#size').oninput=e=>setSize(+e.target.value);$('#sizeDown').onclick=()=>setSize(SIZE-1);$('#sizeUp').onclick=()=>setSize(SIZE+1);
  $('#undoBtn').onclick=undo;$('#redoBtn').onclick=redo;$('#addPageBtn').onclick=addPage;$('#pagePlus').onclick=addPage;$('#paperBtn').onclick=openTemplates;
  $('#importBtn').onclick=()=>App.chooseImport();
  $('#importFile').onchange=e=>App.importFiles(e);$('#audioBtn').onclick=toggleRecording;$('#recordToggle').onclick=toggleRecording;$('#transcribeBtn').onclick=toggleTranscription;
  $('#plainText').oninput=e=>{if(!NOTE||sharedMode==='view')return;NOTE.plain_text=e.target.value;scheduleSave()};
  $('#transcript').oninput=e=>{if(!NOTE||sharedMode==='view')return;NOTE.transcript=e.target.innerText;scheduleSave()};
  $('#presentBtn').onclick=enterPresentation;$('#exitPresent').onclick=exitPresentation;$('#shareBtn').onclick=openShare;$('#classShare').onclick=openShare;
  $('#prevPageClass').onclick=()=>setPage(PAGE-1);$('#nextPageClass').onclick=()=>setPage(PAGE+1);
  $('#templatesBtn').onclick=openTemplates;$('#flashcardsBtn').onclick=()=>{if(NOTE){$('#studyPane').classList.remove('hidden');$('#audioPane,#textPane').classList.add('hidden');$$('.inspTabs button').forEach(x=>x.classList.toggle('on',x.dataset.tab==='study'))}else toast('Open a note')};
  $('#backupBtn').onclick=backup;$('#settingsBtn').onclick=openSettings;$('#themeBtn').onclick=toggleTheme;
  $('#moreBtn').onclick=openMore;$('#penOnlyBtn').onclick=togglePenOnly;$('#splitBtn').onclick=openSplit;$('#penTuneBtn').onclick=openPenSettings;
  $('#summaryBtn').onclick=localSummary;$('#genCardsBtn').onclick=generateCards;$('#quizBtn').onclick=runQuiz;$('#mathBtn').onclick=insertLatex;
  $$('.inspTabs button').forEach(b=>b.onclick=()=>{$$('.inspTabs button').forEach(x=>x.classList.toggle('on',x===b));$$('.inspPane').forEach(x=>x.classList.add('hidden'));$('#'+b.dataset.tab+'Pane').classList.remove('hidden')});
  $('#colors').innerHTML=COLORS.map(c=>`<button class="swatch" data-c="${c}" style="background:${c}"></button>`).join(''); $$('#colors .swatch').forEach(b=>b.onclick=()=>setColor(b.dataset.c));
  canvas.addEventListener('pointerdown',pointerDown);canvas.addEventListener('pointermove',pointerMove);canvas.addEventListener('pointerup',pointerUp);canvas.addEventListener('pointercancel',pointerUp);
  overlay.addEventListener('pointerdown',pointerDown);overlay.addEventListener('pointermove',pointerMove);overlay.addEventListener('pointerup',pointerUp);overlay.addEventListener('pointercancel',pointerUp);
  $('#zoomOutBtn').onclick=()=>setZoom(ZOOM/1.15);$('#zoomInBtn').onclick=()=>setZoom(ZOOM*1.15);$('#fitWidthBtn').onclick=fitZoom;
  const viewport=$('#canvasViewport');
  viewport.addEventListener('wheel',trackpadWheel,{passive:false});
  viewport.addEventListener('gesturestart',safariGestureStart,{passive:false});
  viewport.addEventListener('gesturechange',safariGestureChange,{passive:false});
  viewport.addEventListener('gestureend',safariGestureEnd,{passive:false});
  window.addEventListener('keydown',keyHandler);window.addEventListener('resize',fitZoom);
}

function renderLibrary(){
  const alive=S.notes.filter(n=>!n.deleted_at);$('#allCount').textContent=alive.length;$('#favCount').textContent=alive.filter(n=>n.favorite).length;$('#trashCount').textContent=S.notes.filter(n=>n.deleted_at).length;
  $('#folderList').innerHTML=S.folders.map(f=>`<button class="folder" data-id="${f.id}"><span class="folderDot" style="background:${esc(f.color)}"></span><span>${esc(f.name)}</span><span class="count">${alive.filter(n=>n.folder_id==f.id).length}</span></button>`).join('');
  $$('#folderList .folder').forEach(b=>b.onclick=()=>{$$('.navitem,.folder').forEach(x=>x.classList.remove('on'));b.classList.add('on');FILTER='folder';FOLDER=+b.dataset.id;$('#listTitle').textContent=folderName(FOLDER);renderList()});
}
function noteFilter(n){
  const q=($('#search')?.value||'').trim().toLowerCase();
  if(FILTER==='trash'){if(!n.deleted_at)return false}else if(n.deleted_at)return false;
  if(FILTER==='favorite'&&!n.favorite)return false;
  if(FILTER==='recent'){const d=new Date(n.updated_at);if(Date.now()-d.getTime()>7*864e5)return false}
  if(FILTER==='folder'&&n.folder_id!=FOLDER)return false;
  if(q&&!((n.title+' '+(n.plain_text||'')+' '+(n.transcript||'')+' '+(n.tags||'')).toLowerCase().includes(q)))return false;
  return true;
}
function renderList(){
  let arr=S.notes.filter(noteFilter); arr.sort((a,b)=>SORT==='title'?a.title.localeCompare(b.title):(b.updated_at||'').localeCompare(a.updated_at||''));
  const el=$('#noteList');el.className=LISTGRID?'noteCards grid':'noteCards';
  el.innerHTML=arr.length?arr.map(n=>`<div class="noteCard ${NOTE?.id==n.id?'on':''}" data-id="${n.id}"><h3>${n.favorite?'<span class="star">★</span> ':''}${esc(n.title)}</h3><p>${esc((n.plain_text||n.transcript||'Handwritten note').slice(0,110))}</p><div class="noteMeta"><span>${fmtDate(n.updated_at)}</span><span>${n.kind==='pdf'?'PDF':'Note'}</span><span class="folderTag">${esc(folderName(n.folder_id)||'No folder')}</span></div></div>`).join(''):'<div class="listEmpty">No notes here.</div>';
  $$('#noteList .noteCard').forEach(c=>c.onclick=()=>selectNote(+c.dataset.id));
}
async function selectNote(id,skipPreviousSave=false){
  if(!skipPreviousSave&&NOTE&&NOTE.id!==id)await saveNow();
  try{
    const next=await api('GET','/api/notes/'+id);
    NOTE=next;
    document.body.classList.add('noteFocus');
    NOTE.content=NOTE.content||defaultContent(NOTE.paper);
    PAGE=clamp(NOTE.content.activePage||0,0,NOTE.content.pages.length-1);
    undoStack=[];redoStack=[];hydrateEditor();renderList();history.replaceState(null,'','?note='+id);
  }catch(e){console.error('selectNote failed',e);toast('Could not open note: '+e.message)}
}
function hydrateEditor(refit=true){
  if(!NOTE)return;$('#emptyState').classList.add('hidden');$('#editor').classList.remove('hidden');$('#noteTitle').value=NOTE.title||'';$('#plainText').value=NOTE.plain_text||'';$('#transcript').innerText=NOTE.transcript||'';$('#penOnlyBtn').classList.toggle('on',NOTE.content.settings?.penOnly!==false);renderAttachments();renderPages();setPage(PAGE,false);if(refit)setTimeout(fitZoom,20);updateMetaTitle();
}
function updateMetaTitle(){const m=S.notes.find(x=>x.id==NOTE?.id);if(m){m.title=NOTE.title;m.updated_at=NOTE.updated_at||m.updated_at;renderList()}}

const App={
  chooseImport(){
    const input=$('#importFile');
    if(!input){toast('Import control unavailable — reload VanoNote');return;}
    input.click();
  },
  async newNote(opts={}){
    if(sharedToken||creatingNote)return null;
    creatingNote=true;
    const btn=$('#newNote');
    if(btn){btn.disabled=true;btn.setAttribute('aria-busy','true')}
    setCoreBusy(true,'Creating note…');
    try{
      const previous=NOTE;
      if(previous&&sharedMode!=='view') void saveSnapshot(previous);
      const folder=(FOLDER&&S.folders.some(f=>f.id===FOLDER))?FOLDER:null;
      const title=opts.title||'New note';
      const paper=opts.paper||'blank';
      const n=await api('POST','/api/notes',{title,folder_id:folder,paper});
      S.notes=S.notes.filter(x=>x.id!==n.id);
      S.notes.unshift({...n,content:undefined,attachments:undefined});
      NOTE=n;
      NOTE.content=NOTE.content||defaultContent(NOTE.paper);
      PAGE=clamp(NOTE.content.activePage||0,0,NOTE.content.pages.length-1);
      undoStack=[];redoStack=[];
      document.body.classList.add('noteFocus');
      renderLibrary();renderList();hydrateEditor();
      history.replaceState(null,'','?note='+n.id);
      $('#noteTitle')?.focus();$('#noteTitle')?.select();
      toast('New note created');
      return n;
    }catch(e){
      console.error('New Note failed',e);
      toast('Could not create note: '+e.message);
      return null;
    }finally{
      creatingNote=false;
      setCoreBusy(false);
      if(btn){btn.disabled=false;btn.removeAttribute('aria-busy')}
    }
  },
  async importFiles(e){return importFiles(e)}
}; window.App=App;
async function newFolder(){modal(`<div class="modalHead"><h2>New folder</h2><button class="modalClose" onclick="closeModal()">×</button></div><div class="field"><label>Name</label><input id="mfName" value="New folder"></div><div class="field"><label>Color</label><input id="mfColor" type="color" value="#355e4a"></div><div class="modalActions"><button onclick="closeModal()">Cancel</button><button class="primary" id="mfOk">Create</button></div>`);$('#mfName').select();$('#mfOk').onclick=async()=>{const f=await api('POST','/api/folders',{name:$('#mfName').value,color:$('#mfColor').value});S.folders.push(f);closeModal();renderLibrary();toast('Folder created')}}

function setTool(t){TOOL=t;$$('.tool').forEach(b=>b.classList.toggle('on',b.dataset.tool===t));overlay.style.cursor=t==='text'?'text':t==='eraser'?'cell':t==='select'?'crosshair':'crosshair';selection=null;drawOverlay()}
function setColor(c){COLOR=c;$('#customColor').value=/^#[0-9a-f]{6}$/i.test(c)?c:'#17211b';$$('.swatch').forEach(b=>b.classList.toggle('on',b.dataset.c.toLowerCase()===c.toLowerCase()))}
function setSize(n){SIZE=clamp(+n||1,1,40);$('#size').value=SIZE;$('#sizeLabel').textContent=SIZE}
function togglePenOnly(){if(!NOTE)return;NOTE.content.settings=NOTE.content.settings||{};NOTE.content.settings.penOnly=!(NOTE.content.settings.penOnly!==false);$('#penOnlyBtn').classList.toggle('on',NOTE.content.settings.penOnly);scheduleSave();toast(NOTE.content.settings.penOnly?'Pen-only mode enabled':'Touch/mouse input enabled')}
function pushUndo(){const p=page();if(!p)return;undoStack.push(clone({strokes:p.strokes,objects:p.objects}));if(undoStack.length>60)undoStack.shift();redoStack=[];updateUndoButtons()}
function undo(){const p=page();if(!p||!undoStack.length)return;redoStack.push(clone({strokes:p.strokes,objects:p.objects}));const x=undoStack.pop();p.strokes=x.strokes;p.objects=x.objects;selection=null;renderCurrent();scheduleSave();updateUndoButtons()}
function redo(){const p=page();if(!p||!redoStack.length)return;undoStack.push(clone({strokes:p.strokes,objects:p.objects}));const x=redoStack.pop();p.strokes=x.strokes;p.objects=x.objects;selection=null;renderCurrent();scheduleSave();updateUndoButtons()}
function updateUndoButtons(){$('#undoBtn').disabled=!undoStack.length;$('#redoBtn').disabled=!redoStack.length}

function setPage(i,save=true){if(!NOTE)return;i=clamp(i,0,NOTE.content.pages.length-1);PAGE=i;NOTE.content.activePage=i;const p=page();canvas.width=p.width;canvas.height=p.height;overlay.width=p.width;overlay.height=p.height;stage.style.width=(p.width*ZOOM)+'px';stage.style.height=(p.height*ZOOM)+'px';renderCurrent();renderPages();$('#pageStatus').textContent=`Page ${i+1} / ${NOTE.content.pages.length}`;$('#classPage').textContent=`${i+1} / ${NOTE.content.pages.length}`;if(save)scheduleSave()}
function addPage(){if(!NOTE||sharedMode==='view')return;const base=page();NOTE.content.pages.push({id:uid(),name:'Page '+(NOTE.content.pages.length+1),paper:base?.paper||NOTE.paper||'blank',width:base?.width||1600,height:base?.height||2200,strokes:[],objects:[],background:null});setPage(NOTE.content.pages.length-1);scheduleSave()}
function deletePage(){if(!NOTE||NOTE.content.pages.length<=1)return toast('You must keep at least one page');if(!confirm('Delete this page?'))return;NOTE.content.pages.splice(PAGE,1);PAGE=clamp(PAGE,0,NOTE.content.pages.length-1);setPage(PAGE);scheduleSave()}
function renderPages(){if(!NOTE)return;$('#pageThumbs').innerHTML=NOTE.content.pages.map((p,i)=>`<div class="thumb ${i===PAGE?'on':''}" data-i="${i}"><canvas class="thumbCanvas" width="90" height="120"></canvas><span>${i+1}</span></div>`).join('');$$('.thumb').forEach(th=>{th.onclick=()=>setPage(+th.dataset.i);const tc=th.querySelector('canvas'),tctx=tc.getContext('2d');drawPageTo(tctx,NOTE.content.pages[+th.dataset.i],90,120,true)});
}
function setZoom(z){if(!NOTE)return;const p=page();ZOOM=clamp(z,.25,2.4);stage.style.width=(p.width*ZOOM)+'px';stage.style.height=(p.height*ZOOM)+'px';$('#zoomStatus').textContent=Math.round(ZOOM*100)+'%'}
function fitZoom(){if(!NOTE)return;const v=$('#canvasViewport');const p=page();if(!v||!p)return;const w=Math.max(700,v.clientWidth-40);setZoom(w/p.width)}
function zoomAtClient(z,cx,cy){
  if(!NOTE)return;const v=$('#canvasViewport'),p=page();if(!v||!p)return;
  const before=stage.getBoundingClientRect();
  const px=before.width?clamp((cx-before.left)/before.width,0,1):.5;
  const py=before.height?clamp((cy-before.top)/before.height,0,1):.5;
  setZoom(z);
  const after=stage.getBoundingClientRect();
  v.scrollLeft += (after.left+px*after.width)-cx;
  v.scrollTop  += (after.top +py*after.height)-cy;
}
function trackpadWheel(e){
  if(!NOTE||!PENCFG.trackpadPinch)return;
  if(!e.ctrlKey)return;
  e.preventDefault();
  const factor=Math.exp(-e.deltaY*.008);
  zoomAtClient(ZOOM*factor,e.clientX,e.clientY);
}
function safariGestureStart(e){if(!NOTE||!PENCFG.trackpadPinch)return;safariGestureStartZoom=ZOOM;e.preventDefault()}
function safariGestureChange(e){if(!NOTE||!PENCFG.trackpadPinch||safariGestureStartZoom==null)return;e.preventDefault();const r=$('#canvasViewport').getBoundingClientRect();zoomAtClient(safariGestureStartZoom*(e.scale||1),e.clientX||r.left+r.width/2,e.clientY||r.top+r.height/2)}
function safariGestureEnd(e){if(safariGestureStartZoom!=null)e.preventDefault();safariGestureStartZoom=null}

function drawPaper(c,p,w,h,thumb=false){
  const paper=p.paper||'blank'; c.save();c.fillStyle=paper==='blackboard'?'#173128':'#fffefb';c.fillRect(0,0,w,h);
  const sx=w/(p.width||w),sy=h/(p.height||h);
  if(paper==='ruled'){c.strokeStyle='#c8d9ec';c.lineWidth=1;for(let y=90*sy;y<h;y+=70*sy){c.beginPath();c.moveTo(0,y);c.lineTo(w,y);c.stroke()}c.strokeStyle='#e7a7a7';c.beginPath();c.moveTo(115*sx,0);c.lineTo(115*sx,h);c.stroke()}
  if(paper==='grid'){c.strokeStyle='#d8e1dd';c.lineWidth=.8;for(let x=50*sx;x<w;x+=50*sx){c.beginPath();c.moveTo(x,0);c.lineTo(x,h);c.stroke()}for(let y=50*sy;y<h;y+=50*sy){c.beginPath();c.moveTo(0,y);c.lineTo(w,y);c.stroke()}}
  if(paper==='dots'){c.fillStyle='#b8c1bd';for(let x=50*sx;x<w;x+=50*sx)for(let y=50*sy;y<h;y+=50*sy){c.beginPath();c.arc(x,y,thumb?.7:1.4,0,Math.PI*2);c.fill()}}
  if(paper==='cornell'){c.strokeStyle='#c8d9ec';c.lineWidth=1;for(let y=120*sy;y<h-190*sy;y+=70*sy){c.beginPath();c.moveTo(0,y);c.lineTo(w,y);c.stroke()}c.strokeStyle='#c6b7a0';c.lineWidth=2;c.beginPath();c.moveTo(300*sx,0);c.lineTo(300*sx,h-200*sy);c.moveTo(0,h-200*sy);c.lineTo(w,h-200*sy);c.stroke()}
  if(paper==='blackboard'){c.strokeStyle='rgba(255,255,255,.05)';for(let y=20;y<h;y+=25){c.beginPath();c.moveTo(0,y);c.lineTo(w,y);c.stroke()}}
  c.restore();
}
function loadImage(url,cb){if(imgCache.has(url)){const im=imgCache.get(url);if(im.complete)cb(im);else im.addEventListener('load',()=>cb(im),{once:true});return}const im=new Image();imgCache.set(url,im);im.onload=()=>cb(im);im.src=url}
function drawPageTo(c,p,w=p.width,h=p.height,thumb=false){
  const sx=w/p.width,sy=h/p.height;
  const paintInk=()=>{c.save();c.scale(sx,sy);for(const s of p.strokes||[])drawStroke(c,s);for(const o of p.objects||[])drawObject(c,o);c.restore()};
  const base=im=>{c.save();c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,w,h);drawPaper(c,p,w,h,thumb);if(im)c.drawImage(im,0,0,w,h);c.restore();paintInk()};
  if(p.background?.url){const cached=imgCache.get(p.background.url);if(cached?.complete)base(cached);else{base(null);loadImage(p.background.url,im=>base(im))}}else base(null);
}
function renderCurrent(){const p=page();if(!p)return;drawPageTo(ctx,p,p.width,p.height,false);drawOverlay()}
function strokePressureWidth(s,a,b){
  let pr=((a?.p??.5)+(b?.p??a?.p??.5))/2;if(!pr||pr<.03)pr=.5;
  return Math.max(.6,s.size*(s.tool==='highlighter'?2.7:(s.tool==='calligraphy'?(0.65+pr*1.8):(0.6+pr*.9))));
}
function drawStroke(c,s){
  if(s.kind==='shape')return drawShape(c,s);
  const pts=s.pts||[];if(!pts.length)return;c.save();c.lineCap='round';c.lineJoin='round';c.strokeStyle=s.color||'#111';c.globalAlpha=s.tool==='highlighter'?.28:1;
  if(pts.length===1){c.fillStyle=s.color||'#111';c.beginPath();c.arc(pts[0].x,pts[0].y,Math.max(1,strokePressureWidth(s,pts[0],pts[0])/2),0,Math.PI*2);c.fill();c.restore();return}
  if(pts.length===2){c.lineWidth=strokePressureWidth(s,pts[0],pts[1]);c.beginPath();c.moveTo(pts[0].x,pts[0].y);c.lineTo(pts[1].x,pts[1].y);c.stroke();c.restore();return}
  let startPt=pts[0];
  for(let i=1;i<pts.length-1;i++){
    const cur=pts[i],next=pts[i+1];const endPt={x:(cur.x+next.x)/2,y:(cur.y+next.y)/2};
    c.lineWidth=strokePressureWidth(s,pts[i-1],cur);c.beginPath();c.moveTo(startPt.x,startPt.y);c.quadraticCurveTo(cur.x,cur.y,endPt.x,endPt.y);c.stroke();startPt=endPt;
  }
  const last=pts[pts.length-1];c.lineWidth=strokePressureWidth(s,pts[pts.length-2],last);c.beginPath();c.moveTo(startPt.x,startPt.y);c.lineTo(last.x,last.y);c.stroke();c.restore();
}
function drawShape(c,s){c.save();c.strokeStyle=s.color||'#111';c.lineWidth=s.size||3;c.lineCap='round';c.lineJoin='round';const {x1,y1,x2,y2}=s;c.beginPath();if(s.tool==='line'){c.moveTo(x1,y1);c.lineTo(x2,y2)}else if(s.tool==='rect'){c.rect(Math.min(x1,x2),Math.min(y1,y2),Math.abs(x2-x1),Math.abs(y2-y1))}else if(s.tool==='ellipse'){c.ellipse((x1+x2)/2,(y1+y2)/2,Math.abs(x2-x1)/2,Math.abs(y2-y1)/2,0,0,Math.PI*2)}else if(s.tool==='arrow'){c.moveTo(x1,y1);c.lineTo(x2,y2);const a=Math.atan2(y2-y1,x2-x1),l=Math.max(16,s.size*5);c.moveTo(x2,y2);c.lineTo(x2-l*Math.cos(a-.45),y2-l*Math.sin(a-.45));c.moveTo(x2,y2);c.lineTo(x2-l*Math.cos(a+.45),y2-l*Math.sin(a+.45))}c.stroke();c.restore()}
function drawObject(c,o){c.save();if(o.type==='text'){c.fillStyle=o.color||'#111';c.font=`${o.bold?'700 ':''}${o.size||30}px -apple-system, sans-serif`;c.textBaseline='top';const lines=String(o.text||'').split('\n');lines.forEach((l,i)=>c.fillText(l,o.x,o.y+i*(o.size||30)*1.25));}else if(o.type==='image'&&o.url){loadImage(o.url,im=>{c.drawImage(im,o.x,o.y,o.w,o.h)});}c.restore()}
function drawOverlay(){octx.clearRect(0,0,overlay.width,overlay.height);if(activeStroke)drawStroke(octx,activeStroke);if(draftShape)drawShape(octx,draftShape);if(laserStroke){const s={...laserStroke,color:'#ff3434',size:10,tool:'pen'};octx.save();octx.shadowColor='#ff3434';octx.shadowBlur=18;drawStroke(octx,s);octx.restore()}if(selection){octx.save();octx.setLineDash([12,8]);octx.strokeStyle='#4d7dff';octx.lineWidth=2;octx.fillStyle='rgba(77,125,255,.08)';octx.fillRect(selection.x,selection.y,selection.w,selection.h);octx.strokeRect(selection.x,selection.y,selection.w,selection.h);octx.restore()}}
function scheduleOverlay(){if(overlayRAF)return;overlayRAF=requestAnimationFrame(()=>{overlayRAF=0;drawOverlay()})}
function pressureCurve(p){p=clamp(p||.5,.02,1);if(PENCFG.pressureCurve==='soft')return Math.pow(p,.68);if(PENCFG.pressureCurve==='firm')return Math.pow(p,1.55);return p}
function pointFromEvent(e){const r=overlay.getBoundingClientRect(),p=page();const raw=e.pressure&&e.pressure>0?e.pressure:(e.pointerType==='mouse'?.55:.5);return{x:(e.clientX-r.left)*p.width/r.width,y:(e.clientY-r.top)*p.height/r.height,p:pressureCurve(raw),tx:e.tiltX||0,ty:e.tiltY||0,t:recordStart?(performance.now()-recordStart)/1000:null}}
function smoothingAlpha(level,dist){const base={off:1,light:.72,medium:.50,strong:.33,maximum:.22}[level]??.50;return clamp(base+Math.min(.34,dist/42),base,.92)}
function smoothPoint(stroke,raw){if(!stroke||PENCFG.smoothing==='off'||!stroke.pts.length)return raw;const prev=stroke._smoothLast||stroke.pts[stroke.pts.length-1],d=Math.hypot(raw.x-prev.x,raw.y-prev.y),a=smoothingAlpha(PENCFG.smoothing,d);const out={...raw,x:prev.x+(raw.x-prev.x)*a,y:prev.y+(raw.y-prev.y)*a,p:prev.p+(raw.p-prev.p)*Math.min(.85,a+.18)};stroke._smoothLast=out;return out}
function appendCoalescedPoints(stroke,e){const events=(typeof e.getCoalescedEvents==='function'&&e.getCoalescedEvents().length)?e.getCoalescedEvents():[e];for(const ev of events){const raw=pointFromEvent(ev),pt=smoothPoint(stroke,raw),last=stroke.pts[stroke.pts.length-1];if(!last||Math.hypot(pt.x-last.x,pt.y-last.y)>.18)stroke.pts.push(pt)}}
function correctStroke(stroke){if(!PENCFG.strokeCorrection||!stroke||stroke.pts.length<5||PENCFG.smoothing==='off')return stroke;const weights={light:.06,medium:.11,strong:.16,maximum:.20},w=weights[PENCFG.smoothing]??.11,passes=PENCFG.smoothing==='maximum'?2:1;let pts=stroke.pts;for(let pass=0;pass<passes;pass++){const out=[pts[0]];for(let i=1;i<pts.length-1;i++){const a=pts[i-1],b=pts[i],c=pts[i+1];out.push({...b,x:b.x*(1-2*w)+(a.x+c.x)*w,y:b.y*(1-2*w)+(a.y+c.y)*w,p:b.p*.72+(a.p+c.p)*.14})}out.push(pts[pts.length-1]);pts=out}stroke.pts=pts;delete stroke._smoothLast;return stroke}
function inputAllowed(e){if(sharedMode==='view')return false;if(e.pointerType==='pen'){penSeenAt=Date.now();$('#penStatus').textContent=`XP‑Pen / pen detected · pressure ${Math.round((e.pressure||0)*100)}%`;$('#pointerStatus').textContent='Pen';return true}$('#pointerStatus').textContent=e.pointerType==='touch'?'Touch':'Mouse';const po=NOTE?.content?.settings?.penOnly!==false;if(po&&e.pointerType!=='pen')return false;if(e.pointerType==='touch'&&Date.now()-penSeenAt<1000)return false;return true}
function pointerDown(e){if(!NOTE||!page()||!inputAllowed(e))return;e.preventDefault();overlay.setPointerCapture?.(e.pointerId);const pnt=pointFromEvent(e);const stylusEraser=e.pointerType==='pen'&&(e.button===5||(e.buttons&32));const tool=stylusEraser?'eraser':TOOL;
  if(tool==='eraser'){pushUndo();eraseAt(pnt,Math.max(20,SIZE*4));renderCurrent();scheduleSave();return}
  if(tool==='text'){placeText(pnt);return}
  if(tool==='select'){
    if(selection&&pnt.x>=selection.x&&pnt.x<=selection.x+selection.w&&pnt.y>=selection.y&&pnt.y<=selection.y+selection.h){pushUndo();dragSelection={start:pnt,orig:clone(selection),indices:selectedStrokeIndices(selection)};return}
    selection={x:pnt.x,y:pnt.y,w:0,h:0,startX:pnt.x,startY:pnt.y};drawOverlay();return
  }
  if(['line','rect','ellipse','arrow'].includes(tool)){pushUndo();draftShape={id:uid(),kind:'shape',tool,color:COLOR,size:SIZE,x1:pnt.x,y1:pnt.y,x2:pnt.x,y2:pnt.y,t0:pnt.t};drawOverlay();return}
  if(tool==='laser'){laserStroke={id:uid(),tool:'pen',color:'#f33',size:12,pts:[pnt]};drawOverlay();return}
  pushUndo();activeStroke={id:uid(),tool,color:COLOR,size:SIZE,pts:[pnt],t0:pnt.t,_smoothLast:pnt};drawOverlay();
}
function pointerMove(e){if(!NOTE||!page())return;if(e.pointerType==='pen'){$('#penStatus').textContent=`XP‑Pen / pen · pressure ${Math.round((e.pressure||0)*100)}%`;penSeenAt=Date.now()}const pnt=pointFromEvent(e);
  if(activeStroke){e.preventDefault();appendCoalescedPoints(activeStroke,e);scheduleOverlay();return}
  if(draftShape){draftShape.x2=pnt.x;draftShape.y2=pnt.y;scheduleOverlay();return}
  if(laserStroke){appendCoalescedPoints(laserStroke,e);if(laserStroke.pts.length>100)laserStroke.pts.splice(0,laserStroke.pts.length-100);scheduleOverlay();return}
  if(dragSelection){const dx=pnt.x-dragSelection.start.x,dy=pnt.y-dragSelection.start.y;const pp=page();for(const idx of dragSelection.indices){const s=pp.strokes[idx];if(s.kind==='shape'){s.x1+=dx;s.x2+=dx;s.y1+=dy;s.y2+=dy}else(s.pts||[]).forEach(pt=>{pt.x+=dx;pt.y+=dy})}dragSelection.start=pnt;selection.x+=dx;selection.y+=dy;renderCurrent();return}
  if(selection&&selection.startX!==undefined){selection.x=Math.min(selection.startX,pnt.x);selection.y=Math.min(selection.startY,pnt.y);selection.w=Math.abs(pnt.x-selection.startX);selection.h=Math.abs(pnt.y-selection.startY);scheduleOverlay()}
}
function pointerUp(e){if(!NOTE||!page())return;if(activeStroke){appendCoalescedPoints(activeStroke,e);correctStroke(activeStroke);page().strokes.push(activeStroke);activeStroke=null;renderCurrent();renderPages();scheduleSave()}if(draftShape){page().strokes.push(draftShape);draftShape=null;renderCurrent();renderPages();scheduleSave()}if(laserStroke){setTimeout(()=>{laserStroke=null;drawOverlay()},300)}if(dragSelection){dragSelection=null;scheduleSave()}if(selection&&selection.startX!==undefined){delete selection.startX;delete selection.startY;drawOverlay()}}
function selectedStrokeIndices(box){const p=page();const arr=[];(p.strokes||[]).forEach((s,i)=>{if(s.kind==='shape'){const x=Math.min(s.x1,s.x2),y=Math.min(s.y1,s.y2),w=Math.abs(s.x2-s.x1),h=Math.abs(s.y2-s.y1);if(rectsIntersect(box,{x,y,w,h}))arr.push(i)}else if((s.pts||[]).some(pt=>pt.x>=box.x&&pt.x<=box.x+box.w&&pt.y>=box.y&&pt.y<=box.y+box.h))arr.push(i)});return arr}
function rectsIntersect(a,b){return a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y}
function eraseAt(p,r){const pg=page();let best=-1,bestd=1e9;pg.strokes.forEach((s,i)=>{if(s.kind==='shape'){const d=Math.min(distPointSeg(p,{x:s.x1,y:s.y1},{x:s.x2,y:s.y2}),bestd);if(d<bestd){bestd=d;best=i}}else for(const q of s.pts||[]){const d=Math.hypot(p.x-q.x,p.y-q.y);if(d<bestd){bestd=d;best=i}}});if(best>=0&&bestd<r)pg.strokes.splice(best,1)}
function distPointSeg(p,a,b){const vx=b.x-a.x,vy=b.y-a.y,wx=p.x-a.x,wy=p.y-a.y,c1=vx*wx+vy*wy;if(c1<=0)return Math.hypot(p.x-a.x,p.y-a.y);const c2=vx*vx+vy*vy;if(c2<=c1)return Math.hypot(p.x-b.x,p.y-b.y);const t=c1/c2;return Math.hypot(p.x-(a.x+t*vx),p.y-(a.y+t*vy))}
function placeText(pnt){modal(`<div class="modalHead"><h2>Add text</h2><button class="modalClose" onclick="closeModal()">×</button></div><div class="field"><label>Text</label><textarea id="mtxt" rows="6"></textarea></div><div class="field"><label>Size</label><input id="mts" type="number" min="12" max="120" value="32"></div><div class="modalActions"><button onclick="closeModal()">Cancel</button><button class="primary" id="mtok">Add</button></div>`);$('#mtxt').focus();$('#mtok').onclick=()=>{const t=$('#mtxt').value;if(t){pushUndo();page().objects.push({id:uid(),type:'text',x:pnt.x,y:pnt.y,text:t,color:COLOR,size:+$('#mts').value||32});renderCurrent();scheduleSave()}closeModal()}}

function scheduleSave(){if(!NOTE||sharedMode==='view')return;$('#saveState').textContent='Modified…';clearTimeout(saveTimer);saveTimer=setTimeout(saveNow,650)}
async function saveNow(){
  if(!NOTE||sharedMode==='view')return;
  if(saveInFlight){pendingSave=true;return}
  clearTimeout(saveTimer);
  const target=NOTE;
  const targetId=target.id;
  const endpoint=sharedToken?'/api/shared/'+sharedToken:'/api/notes/'+targetId;
  const body={title:target.title,folder_id:target.folder_id,paper:target.paper,favorite:target.favorite,plain_text:target.plain_text||'',transcript:target.transcript||'',tags:target.tags||'',content:clone(target.content)};
  saveInFlight=true;
  if(NOTE?.id===targetId)$('#saveState').textContent='Saving…';
  try{
    const n=await api('PUT',endpoint,body);
    target.revision=n.revision;target.updated_at=n.updated_at;
    const m=S.notes.find(x=>x.id==targetId);
    if(m)Object.assign(m,{title:target.title,folder_id:target.folder_id,paper:target.paper,favorite:target.favorite,plain_text:target.plain_text,transcript:target.transcript,updated_at:target.updated_at,revision:target.revision});
    if(NOTE?.id===targetId)$('#saveState').textContent='Saved';
  }catch(e){
    if(NOTE?.id===targetId)$('#saveState').textContent='Error';
    toast('Save error: '+e.message);
  }finally{
    saveInFlight=false;
    if(pendingSave){pendingSave=false;setTimeout(saveNow,0)}
  }
}

async function uploadBinary(noteId,file,kind){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),120000);
  try{
    const url=`/api/upload?note_id=${noteId}&kind=${encodeURIComponent(kind)}&name=${encodeURIComponent(file.name)}`;
    const r=await fetch(url,{method:'POST',headers:{'Content-Type':file.type||'application/octet-stream'},body:file,signal:controller.signal});
    const text=await r.text();let o={};try{o=text?JSON.parse(text):{}}catch{o={error:text||'Invalid server response'}}
    if(!r.ok)throw new Error(o.error||('Import failed (HTTP '+r.status+')'));
    return o;
  }catch(err){if(err?.name==='AbortError')throw new Error('PDF import timed out. Try a smaller PDF or restart VanoNote.');throw err}
  finally{clearTimeout(timer)}
}
async function importFiles(e){
  const input=e?.target||$('#importFile');
  const files=[...(input?.files||[])];
  if(input)input.value='';
  if(!files.length)return;
  setCoreBusy(true,files.length>1?`Importing ${files.length} files…`:`Importing ${files[0].name}…`);
  try{
    if(!NOTE){
      const first=files[0];
      const base=(first?.name||'New note').replace(/\.[^.]+$/,'');
      const created=await App.newNote({title:base||'New note'});
      if(!created)throw new Error('A note could not be created for the import.');
    }
    for(const f of files){
      if(!NOTE)throw new Error('No note is open.');
      setCoreBusy(true,'Importing '+f.name+'…');
      if(f.name.toLowerCase().endsWith('.vnote')){
        try{const data=JSON.parse(await f.text());if(!data.content)throw new Error('Missing note content');NOTE.content=data.content;NOTE.title=data.title||NOTE.title;NOTE.plain_text=data.plain_text||'';NOTE.transcript=data.transcript||'';hydrateEditor();scheduleSave();toast('VanoNote imported')}catch(err){toast('Invalid .vnote file: '+err.message)}
        continue;
      }
      let kind='file';
      if(f.type==='application/pdf'||f.name.toLowerCase().endsWith('.pdf'))kind='pdf';
      else if((f.type||'').startsWith('image/'))kind='image';
      else if(/\.(docx?|odt)$/i.test(f.name))kind='document';
      else if(/\.(pptx?|odp)$/i.test(f.name))kind='slides';
      const o=await uploadBinary(NOTE.id,f,kind);
      NOTE.attachments=NOTE.attachments||[];NOTE.attachments.push(o);
      if(o.pages?.length){
        NOTE.kind='pdf';
        NOTE.content.pages=o.pages.map((pg,i)=>({id:uid(),name:'Page '+(i+1),paper:'blank',width:pg.width||1200,height:pg.height||1600,strokes:[],objects:[],background:{url:pg.url,type:'pdf',attachment_id:o.id,page:i+1}}));
        NOTE.content.activePage=0;PAGE=0;hydrateEditor();scheduleSave();
        toast(`${o.pages.length} PDF page${o.pages.length===1?'':'s'} ready to annotate`);
      }else if(kind==='image'){
        const im=await loadImagePromise(o.url);const p=page();
        if(!p)throw new Error('No page available for the image.');
        const maxW=p.width*.8,maxH=p.height*.8,sc=Math.min(maxW/im.naturalWidth,maxH/im.naturalHeight,1);
        pushUndo();p.objects.push({id:uid(),type:'image',url:o.url,x:80,y:80,w:im.naturalWidth*sc,h:im.naturalHeight*sc});renderCurrent();scheduleSave();toast('Image added');
      }else if(o.render_error){toast('File attached, but preview failed: '+o.render_error)}
      else if(o.conversion_error){toast('File attached: '+o.conversion_error)}
      renderAttachments();
    }
  }catch(err){console.error('Import failed',err);toast('Import failed: '+err.message)}
  finally{setCoreBusy(false)}
}
function loadImagePromise(url){return new Promise(res=>loadImage(url,res))}
function renderAttachments(){if(!NOTE)return;const a=NOTE.attachments||[];$('#attachmentList').innerHTML=a.length?a.map(x=>`<div class="attachment"><span>${x.kind==='audio'?'♪':x.kind==='pdf'?'PDF':'▧'}</span><a href="${x.url}" target="_blank">${esc(x.name)}</a></div>`).join(''):'<div class="listEmpty" style="padding:12px">No attachments</div>';const aud=a.filter(x=>x.kind==='audio');$('#audioList').innerHTML=aud.map(x=>`<div class="audioItem"><audio controls src="${x.url}"></audio><a href="${x.url}" target="_blank">↗</a></div>`).join('')}

async function toggleRecording(){if(sharedMode==='view')return;if(mediaRecorder&&mediaRecorder.state==='recording')return stopRecording();try{audioStream=await navigator.mediaDevices.getUserMedia({audio:true});mediaChunks=[];const mime=MediaRecorder.isTypeSupported('audio/webm;codecs=opus')?'audio/webm;codecs=opus':'';mediaRecorder=new MediaRecorder(audioStream,mime?{mimeType:mime}:undefined);mediaRecorder.ondataavailable=e=>{if(e.data.size)mediaChunks.push(e.data)};mediaRecorder.onstop=saveRecording;mediaRecorder.start(500);recordStart=performance.now();$('#recordStatus').textContent='Recording';$('#recordToggle').textContent='Stop';$('#audioBtn').classList.add('primary');recordTick=setInterval(()=>$('#recordTimer').textContent=fmtTime((performance.now()-recordStart)/1000),500);toast('Audio recording started');if(!transcribing)startTranscription(false)}catch(e){toast('Microphone unavailable: '+e.message)}}
function stopRecording(){if(mediaRecorder?.state==='recording')mediaRecorder.stop();audioStream?.getTracks().forEach(t=>t.stop());clearInterval(recordTick);$('#recordToggle').textContent='Record';$('#audioBtn').classList.remove('primary');$('#recordStatus').textContent='Recording finished'}
async function saveRecording(){if(!mediaChunks.length||!NOTE)return;const blob=new Blob(mediaChunks,{type:mediaRecorder.mimeType||'audio/webm'});const name=`${NOTE.title||'note'}_${new Date().toISOString().replace(/[:.]/g,'-')}.webm`;try{const r=await fetch(`/api/upload?note_id=${NOTE.id}&kind=audio&name=${encodeURIComponent(name)}`,{method:'POST',headers:{'Content-Type':blob.type},body:blob});const o=await r.json();NOTE.attachments.push(o);renderAttachments();toast('Audio saved in VanoNote/audio')}catch(e){toast('Error audio: '+e.message)}recordStart=0;mediaChunks=[];scheduleSave()}
function speechCtor(){return window.SpeechRecognition||window.webkitSpeechRecognition}
function toggleTranscription(){transcribing?stopTranscription():startTranscription(true)}
function startTranscription(showToast=true){const C=speechCtor();if(!C){if(showToast)toast('Browser transcription is not available in this browser');return}recognition=new C();recognition.lang='en-CA';recognition.continuous=true;recognition.interimResults=true;let base=NOTE?.transcript||'';recognition.onresult=e=>{let final='',interim='';for(let i=e.resultIndex;i<e.results.length;i++){const t=e.results[i][0].transcript;if(e.results[i].isFinal)final+=t+' ';else interim+=t}if(final){base=(base+(base?' ':'')+final.trim()).trim();NOTE.transcript=base;scheduleSave()}$('#transcript').innerText=(base+(interim?' '+interim:'')).trim()};recognition.onend=()=>{if(transcribing)try{recognition.start()}catch{}};try{recognition.start();transcribing=true;$('#transcribeBtn').classList.add('primary');if(showToast)toast('Live transcription enabled')}catch(e){toast(e.message)}}
function stopTranscription(){transcribing=false;try{recognition?.stop()}catch{}$('#transcribeBtn').classList.remove('primary');if(NOTE){NOTE.transcript=$('#transcript').innerText;scheduleSave()}}

function openTemplates(){if(!NOTE)return toast('Open a note');const items=[['blank','Blank'],['ruled','Ruled'],['grid','Grid'],['dots','Dots'],['cornell','Cornell'],['blackboard','Blackboard']];modal(`<div class="modalHead"><h2>Paper & templates</h2><button class="modalClose" onclick="closeModal()">×</button></div><div class="templateGrid">${items.map(([k,n])=>`<button class="template" data-paper="${k}"><div class="paperPreview" data-pv="${k}"></div><b>${n}</b></button>`).join('')}</div><div class="modalActions"><button id="applyAllPaper">Apply to all pages</button></div>`);$$('.template').forEach(b=>b.onclick=()=>{page().paper=b.dataset.paper;NOTE.paper=b.dataset.paper;renderCurrent();renderPages();scheduleSave();closeModal()});$('#applyAllPaper').onclick=()=>{const paper=page().paper;NOTE.content.pages.forEach(p=>p.paper=paper);renderCurrent();renderPages();scheduleSave();closeModal()};$$('[data-pv]').forEach(d=>{const k=d.dataset.pv;if(k==='grid')d.style.backgroundImage='linear-gradient(#d9e3df 1px,transparent 1px),linear-gradient(90deg,#d9e3df 1px,transparent 1px)',d.style.backgroundSize='14px 14px';if(k==='ruled')d.style.backgroundImage='repeating-linear-gradient(#fff 0,#fff 13px,#ccdaea 14px)';if(k==='dots')d.style.backgroundImage='radial-gradient(#9fa9a5 1px,transparent 1px)',d.style.backgroundSize='14px 14px';if(k==='blackboard')d.style.background='#173128';if(k==='cornell')d.style.background='linear-gradient(90deg,transparent 29%,#c9baa2 30%,transparent 31%),linear-gradient(0deg,transparent 18%,#c9baa2 19%,transparent 20%),#fff'})}
function openShare(){if(!NOTE||sharedToken)return;modal(`<div class="modalHead"><h2>Share with students</h2><button class="modalClose" onclick="closeModal()">×</button></div><p style="color:var(--mut);font-size:12px">The link works on the same Wi-Fi network or through Tailscale. For Zoom/Meet/Teams, you can also share the VanoNote window directly.</p><div class="field"><label>Mode</label><select id="shareMode"><option value="view">Read only — students watch</option><option value="edit">Collaborative — students can write</option><option value="none">Disable sharing</option></select></div><div id="shareResult"></div><div class="modalActions"><button onclick="closeModal()">Close</button><button class="primary" id="shareGo">Create / update link</button></div>`);$('#shareMode').value=NOTE.share_mode||'view';$('#shareGo').onclick=async()=>{const r=await api('POST',`/api/notes/${NOTE.id}/share`,{mode:$('#shareMode').value});NOTE.share_mode=r.mode;NOTE.share_token=r.token;$('#shareResult').innerHTML=r.url?`<div class="field"><label>Student link</label><input id="shareUrl" value="${esc(r.url)}" readonly></div><div style="display:flex;gap:6px"><button id="copyShare" class="primary" style="padding:7px 10px;border-radius:7px">Copy</button><button id="openShare" style="padding:7px 10px;border:1px solid var(--line);border-radius:7px">Open student view</button></div>`:'<p>Sharing disabled.</p>';if(r.url){$('#copyShare').onclick=()=>navigator.clipboard.writeText(r.url).then(()=>toast('Link copied'));$('#openShare').onclick=()=>window.open(r.url,'_blank')}}}
function enterPresentation(){if(!NOTE)return;document.body.classList.add('presentation');$('#classbar').classList.remove('hidden');$('#classInfo').textContent='Teacher whiteboard';fitZoom();try{document.documentElement.requestFullscreen?.()}catch{}}
function exitPresentation(){document.body.classList.remove('presentation');if(document.fullscreenElement)document.exitFullscreen?.();fitZoom()}
function openMore(){if(!NOTE)return;modal(`<div class="modalHead"><h2>Note actions</h2><button class="modalClose" onclick="closeModal()">×</button></div><div class="modalList"><button class="wide" id="favAct">${NOTE.favorite?'☆ Remove from favorites':'★ Add to favorites'}</button><button class="wide" id="moveAct">▣ Move to folder</button><button class="wide" id="dupAct">⧉ Duplicate</button><button class="wide" id="exportAct">↥ Export .vnote</button><button class="wide" id="printAct">⎙ Print / Save PDF</button><button class="wide" id="histAct">◷ Version history</button><button class="wide" id="delPageAct">⌫ Delete this page</button><button class="wide" id="trashAct" style="color:var(--red)">⌫ Move to Trash</button></div>`);$('#favAct').onclick=()=>{NOTE.favorite=NOTE.favorite?0:1;scheduleSave();const m=S.notes.find(n=>n.id==NOTE.id);if(m)m.favorite=NOTE.favorite;closeModal();renderLibrary();renderList()};$('#moveAct').onclick=openMove;$('#dupAct').onclick=duplicateNote;$('#exportAct').onclick=exportVnote;$('#printAct').onclick=printNote;$('#histAct').onclick=openHistory;$('#delPageAct').onclick=()=>{closeModal();deletePage()};$('#trashAct').onclick=trashNote}
function openMove(){modal(`<div class="modalHead"><h2>Move note</h2><button class="modalClose" onclick="closeModal()">×</button></div><div class="field"><label>Folder</label><select id="moveFolder"><option value="">No folder</option>${S.folders.map(f=>`<option value="${f.id}" ${NOTE.folder_id==f.id?'selected':''}>${esc(f.name)}</option>`).join('')}</select></div><div class="modalActions"><button onclick="closeModal()">Cancel</button><button class="primary" id="moveOk">Move</button></div>`);$('#moveOk').onclick=()=>{NOTE.folder_id=+$('#moveFolder').value||null;scheduleSave();const m=S.notes.find(n=>n.id==NOTE.id);if(m)m.folder_id=NOTE.folder_id;closeModal();renderLibrary();renderList()}}
async function duplicateNote(){const n=await api('POST',`/api/notes/${NOTE.id}/duplicate`,{});S.notes.unshift({...n,content:undefined,attachments:undefined});closeModal();renderLibrary();renderList();selectNote(n.id);toast('Note duplicated')}
function exportVnote(){const data={format:'VanoNote',version:1,title:NOTE.title,folder:folderName(NOTE.folder_id),paper:NOTE.paper,plain_text:NOTE.plain_text,transcript:NOTE.transcript,tags:NOTE.tags,content:NOTE.content,exported_at:new Date().toISOString()};const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});downloadBlob(blob,(NOTE.title||'VanoNote').replace(/[^\w\- ]/g,'_')+'.vnote');closeModal()}
function downloadBlob(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000)}
async function printNote(){closeModal();const w=window.open('','_blank');const pages=NOTE.content.pages;const urls=[];for(const p of pages){if(p.background?.url)urls.push(p.background.url);for(const o of p.objects||[])if(o.type==='image'&&o.url)urls.push(o.url)}await Promise.all([...new Set(urls)].map(u=>loadImagePromise(u).catch(()=>null)));const imgs=[];for(const p of pages){const c=document.createElement('canvas');c.width=p.width;c.height=p.height;const cc=c.getContext('2d');drawPageTo(cc,p,p.width,p.height,false);imgs.push(c.toDataURL('image/png'))}w.document.write(`<html><head><title>${esc(NOTE.title)}</title><style>@page{margin:0}body{margin:0;background:#fff}.p{page-break-after:always;width:100vw;display:block}</style></head><body>${imgs.map(x=>`<img class="p" src="${x}">`).join('')}<script>onload=()=>setTimeout(()=>print(),500)<\/script></body></html>`);w.document.close()}
async function openHistory(){const rows=await api('GET',`/api/notes/${NOTE.id}/versions`);modal(`<div class="modalHead"><h2>Version history</h2><button class="modalClose" onclick="closeModal()">×</button></div><div class="modalList">${rows.length?rows.map(v=>`<div class="versionRow"><span>${esc(v.title)} · ${new Date(v.created_at).toLocaleString('en-CA')}</span><button data-v="${v.id}">Restore</button></div>`).join(''):'<div class="listEmpty">No previous versions yet.</div>'}</div>`);$$('.versionRow button').forEach(b=>b.onclick=async()=>{if(!confirm('Restore this version?'))return;NOTE=await api('POST',`/api/notes/${NOTE.id}/restore-version/${b.dataset.v}`,{});NOTE.content=NOTE.content||defaultContent();closeModal();hydrateEditor();toast('Version restored')})}
async function trashNote(){const id=NOTE.id;if(!confirm('Move this note to Trash?'))return;await api('DELETE','/api/notes/'+id);const m=S.notes.find(n=>n.id==id);if(m)m.deleted_at=new Date().toISOString();NOTE=null;closeModal();$('#editor').classList.add('hidden');$('#emptyState').classList.remove('hidden');$('#noteTitle').value='';renderLibrary();renderList();history.replaceState(null,'','/');toast('Note moved to Trash')}

function localSummary(){if(!NOTE)return;const txt=((NOTE.plain_text||'')+' '+(NOTE.transcript||'')).replace(/\s+/g,' ').trim();if(!txt)return $('#studyOutput').innerHTML='<div class="studyCard">Add text or a transcript to generate a summary.</div>';const sentences=txt.match(/[^.!?]+[.!?]+|[^.!?]+$/g)||[txt];const picks=sentences.filter(s=>s.trim().length>25).slice(0,7);$('#studyOutput').innerHTML='<div class="studyCard"><b>Summary</b><ul>'+picks.map(s=>'<li>'+esc(s.trim())+'</li>').join('')+'</ul></div>'}
function generateCards(){if(!NOTE)return;const txt=((NOTE.plain_text||'')+' '+(NOTE.transcript||'')).replace(/\s+/g,' ').trim();const sentences=(txt.match(/[^.!?]+[.!?]+|[^.!?]+$/g)||[]).filter(s=>s.trim().length>35).slice(0,12);const cards=sentences.map((s,i)=>{const words=s.trim().split(/\s+/);const idx=Math.min(words.length-1,Math.max(2,Math.floor(words.length*.45)));const ans=words[idx].replace(/[.,;:!?]/g,'');words[idx]='_____';return{q:words.join(' '),a:ans}});NOTE._cards=cards;$('#studyOutput').innerHTML=cards.length?cards.map((c,i)=>`<div class="studyCard"><b>Card ${i+1}</b>${esc(c.q)}<details><summary>Answer</summary>${esc(c.a)}</details></div>`).join(''):'<div class="studyCard">Not enough text to generate flashcards.</div>'}
function runQuiz(){if(!NOTE._cards?.length)generateCards();const cards=NOTE._cards||[];if(!cards.length)return;let i=0,score=0;const show=()=>{const c=cards[i];$('#studyOutput').innerHTML=`<div class="studyCard"><b>Question ${i+1}/${cards.length}</b><p>${esc(c.q)}</p><input id="quizAns" style="width:100%;padding:7px"><button id="quizCheck" class="wide primary" style="margin-top:7px">Check</button></div>`;$('#quizCheck').onclick=()=>{const ok=$('#quizAns').value.trim().toLowerCase()===c.a.toLowerCase();if(ok)score++;toast(ok?'Correct':'Answer: '+c.a);i++;if(i<cards.length)setTimeout(show,400);else $('#studyOutput').innerHTML=`<div class="studyCard"><b>Result</b>${score} / ${cards.length}</div>`}};show()}
function insertLatex(){const ta=$('#plainText');const t='\\[\n  % LaTeX equation\n\\]';const a=ta.selectionStart,b=ta.selectionEnd;ta.value=ta.value.slice(0,a)+t+ta.value.slice(b);NOTE.plain_text=ta.value;scheduleSave();ta.focus();ta.selectionStart=ta.selectionEnd=a+3}

async function backup(){try{const r=await api('POST','/api/backup',{});toast('Backup created in VanoNote/backups');modal(`<div class="modalHead"><h2>VanoNote Backup</h2><button class="modalClose" onclick="closeModal()">×</button></div><p>The backup was created in the <b>backups</b> folder of VanoNote.</p><div class="modalActions"><a href="${r.url}" style="padding:8px 12px;background:var(--acc);color:#fff;border-radius:8px;text-decoration:none">Download a copy</a></div>`)}catch(e){toast(e.message)}}
function openPenSettings(){
  modal(`<div class="modalHead"><h2>XP‑Pen & Handwriting</h2><button class="modalClose" onclick="closeModal()">×</button></div>
  <div class="field"><label>Smoothing</label><select id="setSmooth"><option value="off">Off — raw pen</option><option value="light">Light</option><option value="medium">Medium (recommended)</option><option value="strong">Strong</option><option value="maximum">Maximum</option></select></div>
  <div class="field"><label>Automatic stroke correction</label><select id="setCorrect"><option value="1">On — remove small hand jitter after each stroke</option><option value="0">Off — keep the exact captured stroke</option></select></div>
  <div class="field"><label>Pressure curve</label><select id="setPressure"><option value="soft">Soft — reaches thick strokes earlier</option><option value="linear">Linear — direct XP‑Pen pressure</option><option value="firm">Firm — requires more pressure</option></select></div>
  <div class="field"><label>Mac trackpad</label><select id="setTrackpad"><option value="1">Two-finger scroll + pinch zoom</option><option value="0">Two-finger scroll only</option></select></div>
  <div class="penHelp">VanoNote receives pressure/tilt through the browser Pointer Events API. The XPPen driver itself stays a macOS system driver; use the XPPen app for tablet mapping and hardware pressure calibration.</div>
  <div class="modalActions"><button id="penDefaults">Defaults</button><button class="primary" id="penSave">Save</button></div>`);
  $('#setSmooth').value=PENCFG.smoothing;$('#setCorrect').value=PENCFG.strokeCorrection?'1':'0';$('#setPressure').value=PENCFG.pressureCurve;$('#setTrackpad').value=PENCFG.trackpadPinch?'1':'0';
  $('#penDefaults').onclick=()=>{$('#setSmooth').value='medium';$('#setCorrect').value='1';$('#setPressure').value='linear';$('#setTrackpad').value='1'};
  $('#penSave').onclick=()=>{PENCFG={smoothing:$('#setSmooth').value,strokeCorrection:$('#setCorrect').value==='1',pressureCurve:$('#setPressure').value,trackpadPinch:$('#setTrackpad').value==='1'};localStorage.setItem('vn_pen_config',JSON.stringify(PENCFG));closeModal();toast('XP‑Pen settings saved')};
}
function openSettings(){const pen=NOTE?.content?.settings?.penOnly!==false;modal(`<div class="modalHead"><h2>VanoNote Settings</h2><button class="modalClose" onclick="closeModal()">×</button></div><div class="field"><label>Data folder</label><input readonly value="~/Desktop/VanoNote/ — data, attachments, audio, exports and backups"></div><div class="field"><label>XP‑Pen / pen</label><select id="setPen"><option value="1" ${pen?'selected':''}>Pen-only mode (recommended for teaching)</option><option value="0" ${!pen?'selected':''}>Allow mouse/touch drawing</option></select></div><button class="wide" id="openPenTune">⌁ XP‑Pen smoothing, pressure & trackpad</button><div class="field"><label>Shortcuts to map to XP‑Pen buttons</label><textarea readonly rows="5">P = Pen    H = Highlighter    E = Eraser    L = Laser\nV = Lasso    T = Text         C = Calligraphy\nZ = Undo  Shift+Z = Redo   [ / ] = Size\nF = Presentation   ← / → = Pages</textarea></div><div class="field"><label>PDF</label><input readonly value="${S.fitz?'PyMuPDF installed — full PDF import':'PyMuPDF missing — run install_dependencies.command'}"></div><div class="modalActions"><button class="primary" id="setOk">Save</button></div>`);$('#openPenTune').onclick=()=>openPenSettings();$('#setOk').onclick=()=>{if(NOTE){NOTE.content.settings=NOTE.content.settings||{};NOTE.content.settings.penOnly=$('#setPen').value==='1';$('#penOnlyBtn').classList.toggle('on',NOTE.content.settings.penOnly);scheduleSave()}closeModal()}}
function openSplit(){if(!NOTE)return;const opts=S.notes.filter(n=>!n.deleted_at&&n.id!==NOTE.id);if(!opts.length)return toast('No other note');modal(`<div class="modalHead"><h2>Split note</h2><button class="modalClose" onclick="closeModal()">×</button></div><div class="field"><label>Open a reference note on the right</label><select id="splitSel">${opts.map(n=>`<option value="${n.id}">${esc(n.title)}</option>`).join('')}</select></div><div class="modalActions"><button class="primary" id="splitOk">Open</button></div>`);$('#splitOk').onclick=async()=>{const n=await api('GET','/api/notes/'+$('#splitSel').value);closeModal();document.querySelector('.splitReference')?.remove();const d=document.createElement('div');d.className='splitReference';d.innerHTML=`<header><b>${esc(n.title)}</b><button>×</button></header><div class="refbody">${esc(n.plain_text||n.transcript||'Handwritten note — use the page list to view it in VanoNote.')}</div>`;d.querySelector('button').onclick=()=>d.remove();$('#canvasViewport').appendChild(d)}}
const THEME_LABELS={autumn:'☀ Autumn',night:'☾ Night',quantum:'✦ Quantum'};
function applyTheme(t){if(!THEME_LABELS[t])t='autumn';document.documentElement.dataset.theme=t==='autumn'?'':t;localStorage.setItem('vn_theme',t);const b=$('#themeBtn');if(b)b.textContent=THEME_LABELS[t]}
function toggleTheme(){const a=['autumn','night','quantum'],c=localStorage.getItem('vn_theme')||'autumn',n=a[(a.indexOf(c)+1)%a.length];applyTheme(n);toast('Theme: '+THEME_LABELS[n].replace(/^[^ ]+ /,''))}

function keyHandler(e){const tag=document.activeElement?.tagName;if(['INPUT','TEXTAREA'].includes(tag)||document.activeElement?.isContentEditable){if(e.key==='Escape')document.activeElement.blur();return}if(e.key==='Escape'){exitPresentation();selection=null;drawOverlay();closeModal();return}const k=e.key.toLowerCase();if(k==='p')setTool('pen');else if(k==='c')setTool('calligraphy');else if(k==='h')setTool('highlighter');else if(k==='e')setTool('eraser');else if(k==='l')setTool('laser');else if(k==='v')setTool('select');else if(k==='t')setTool('text');else if(k==='f')enterPresentation();else if(k==='z'&&!e.shiftKey){e.preventDefault();undo()}else if((k==='z'&&e.shiftKey)||k==='y'){e.preventDefault();redo()}else if(e.key==='[')setSize(SIZE-1);else if(e.key===']')setSize(SIZE+1);else if(e.key==='ArrowRight'&&document.body.classList.contains('presentation'))setPage(PAGE+1);else if(e.key==='ArrowLeft'&&document.body.classList.contains('presentation'))setPage(PAGE-1);else if((e.key==='Delete'||e.key==='Backspace')&&selection){const inds=selectedStrokeIndices(selection).sort((a,b)=>b-a);if(inds.length){pushUndo();inds.forEach(i=>page().strokes.splice(i,1));selection=null;renderCurrent();scheduleSave()}}}

window.closeModal=closeModal;
window.addEventListener('beforeunload',()=>{if(NOTE&&sharedMode!=='view')navigator.sendBeacon?.('/api/ping','')});
boot().catch(e=>{console.error(e);toast('Error VanoNote: '+e.message)});

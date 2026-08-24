import { tearImage } from './tear.js';
import { buildBrightnessMap, renderMapToCanvas } from './analyzeTarget.js';
import { compose } from './composer.js';

const $ = s=>document.querySelector(s);
const sourceDrop=$('#sourceDrop'), targetDrop=$('#targetDrop');
const sourcePreview=$('#sourcePreview'), targetPreview=$('#targetPreview');
const sourceFile=$('#sourceFile'), targetFile=$('#targetFile');
const sourceUrl=$('#sourceUrl'), targetUrl=$('#targetUrl');
const btnTear=$('#btnTear'), btnCompose=$('#btnCompose'), btnExport=$('#btnExport');
const statusEl=$('#status'), trayEl=$('#tray'), paletteBar=$('#paletteBar');
const collageCanvas=$('#collageCanvas'), mapCanvas=$('#mapCanvas');
const pieceCountLabel=$('#pieceCountLabel');

let sourceCanvas=null, targetCanvas=null; // offscreen canvases at native resolution
let torn = null; // {pieces, palette}
let brightnessMap=null;
let targetW=0, targetH=0;
let seeds=[]; // for seededUser mode: [{x,y,L}]

function setStatus(m){ statusEl.textContent=m; }

// ---------- image loading helpers ----------
function canvasFromImage(img, maxSide=1200){
  let w=img.naturalWidth||img.width, h=img.naturalHeight||img.height;
  const s=Math.min(1, maxSide/Math.max(w,h));
  w=Math.round(w*s); h=Math.round(h*s);
  const c=document.createElement('canvas'); c.width=w; c.height=h;
  c.getContext('2d').drawImage(img,0,0,w,h);
  return c;
}
function drawPreview(previewCanvas, srcCanvas, dropEl){
  const ctx=previewCanvas.getContext('2d');
  const w=previewCanvas.width, h=previewCanvas.height;
  ctx.clearRect(0,0,w,h);
  ctx.fillStyle='#0b0e13'; ctx.fillRect(0,0,w,h);
  if(!srcCanvas){ dropEl.classList.remove('hasImage'); return; }
  const scale=Math.min(w/srcCanvas.width, h/srcCanvas.height);
  const dw=srcCanvas.width*scale, dh=srcCanvas.height*scale;
  const ox=(w-dw)/2, oy=(h-dh)/2;
  ctx.drawImage(srcCanvas, ox,oy,dw,dh);
  dropEl.classList.add('hasImage');
}
async function loadFromFile(file, kind){
  const url=URL.createObjectURL(file);
  const img=new Image();
  img.decoding='async';
  const loaded=await new Promise((res,rej)=>{ img.onload=()=>res(true); img.onerror=rej; img.src=url; });
  const c=canvasFromImage(img);
  URL.revokeObjectURL(url);
  if(kind==='source'){ sourceCanvas=c; drawPreview(sourcePreview, sourceCanvas, sourceDrop); }
  else { targetCanvas=c; targetW=c.width; targetH=c.height; drawPreview(targetPreview, targetCanvas, targetDrop); seeds=[]; }
  setStatus(`Loaded ${kind}: ${c.width}×${c.height}`);
}
async function loadFromUrl(urlStr, kind){
  if(!urlStr) return;
  setStatus(`Fetching ${kind} URL…`);
  // Try direct fetch as blob to avoid CORS taint if possible with crossorigin
  try{
    const img=new Image();
    img.crossOrigin='anonymous';
    await new Promise((res,rej)=>{
      img.onload=res; img.onerror=()=>rej(new Error('CORS or 404'));
      img.src=urlStr;
    });
    const c=canvasFromImage(img);
    if(kind==='source'){ sourceCanvas=c; drawPreview(sourcePreview, sourceCanvas, sourceDrop); }
    else { targetCanvas=c; targetW=c.width; targetH=c.height; drawPreview(targetPreview, targetCanvas, targetDrop); seeds=[]; }
    setStatus(`Fetched ${kind}: ${c.width}×${c.height}`);
  } catch(e){
    // fallback fetch via proxy not included; instruct user
    setStatus(`URL fetch failed (CORS). Try download & drop. ${e.message}`);
    console.error(e);
  }
}

// ---------- drag & drop ----------
// Now file inputs are overlayed with opacity:0 covering the dropzone, so native
// click opens the file picker even if JS failed to load. We keep JS only for
// change/drag handling. Extra click handler is kept for keyboard access but not required.
function wireDrop(dropEl, fileInput, kind){
  fileInput.addEventListener('change', e=>{
    if(e.target.files[0]) loadFromFile(e.target.files[0], kind);
    // reset so same file can be re-selected
    e.target.value='';
  });
  dropEl.addEventListener('dragover', e=>{ e.preventDefault(); dropEl.classList.add('dragover'); });
  dropEl.addEventListener('dragleave', ()=> dropEl.classList.remove('dragover'));
  dropEl.addEventListener('drop', e=>{
    e.preventDefault(); dropEl.classList.remove('dragover');
    const f=e.dataTransfer.files[0];
    if(f) loadFromFile(f, kind);
    else {
      const url=e.dataTransfer.getData('text/uri-list')||e.dataTransfer.getData('text/plain');
      if(url && url.startsWith('http')) loadFromUrl(url.trim(), kind);
    }
  });
  // Prevent overlay input clicks from triggering seededUser logic underneath
  fileInput.addEventListener('click', e=> e.stopPropagation());
}
wireDrop(sourceDrop, sourceFile, 'source');
wireDrop(targetDrop, targetFile, 'target');
$('#sourceUrlBtn').addEventListener('click', ()=> loadFromUrl(sourceUrl.value.trim(),'source'));
$('#targetUrlBtn').addEventListener('click', ()=> loadFromUrl(targetUrl.value.trim(),'target'));
sourceUrl.addEventListener('keydown', e=>{ if(e.key==='Enter') loadFromUrl(sourceUrl.value.trim(),'source'); });
targetUrl.addEventListener('keydown', e=>{ if(e.key==='Enter') loadFromUrl(targetUrl.value.trim(),'target'); });

// ---------- seeded user clicks ----------
targetPreview.addEventListener('click', e=>{
  if($('#targetMode').value!=='seededUser' || !targetCanvas) return;
  const rect=targetPreview.getBoundingClientRect();
  // map preview coords -> targetCanvas coords
  const scaleX=targetCanvas.width / targetPreview.width;
  const scaleY=targetCanvas.height / targetPreview.height;
  // we drew centered with contain, need to account for letterbox
  const previewScale=Math.min(targetPreview.width/targetCanvas.width, targetPreview.height/targetCanvas.height);
  const dw=targetCanvas.width*previewScale, dh=targetCanvas.height*previewScale;
  const ox=(targetPreview.width-dw)/2, oy=(targetPreview.height-dh)/2;
  const px=e.clientX-rect.left - ox, py=e.clientY-rect.top - oy;
  if(px<0||px>dw||py<0||py>dh) return;
  const tx=Math.round(px/previewScale), ty=Math.round(py/previewScale);
  // cycle L values: 0,25,50,75,100
  const cycle=[0,25,50,75,100];
  const L = cycle[seeds.length % cycle.length];
  seeds.push({x:tx,y:ty,L});
  drawSeedOverlays();
  setStatus(`Seed ${seeds.length}: (${tx},${ty}) → L=${L}. Click again to add, right-click to undo.`);
});
targetPreview.addEventListener('contextmenu', e=>{
  e.preventDefault();
  if(seeds.length){ seeds.pop(); drawSeedOverlays(); setStatus(`Removed last seed. ${seeds.length} remain.`); }
});
function drawSeedOverlays(){
  drawPreview(targetPreview, targetCanvas, targetDrop);
  const ctx=targetPreview.getContext('2d');
  const s=Math.min(targetPreview.width/targetCanvas.width, targetPreview.height/targetCanvas.height);
  const dw=targetCanvas.width*s, dh=targetCanvas.height*s;
  const ox=(targetPreview.width-dw)/2, oy=(targetPreview.height-dh)/2;
  for(let i=0;i<seeds.length;i++){
    const se=seeds[i];
    const x=ox+se.x*s, y=oy+se.y*s;
    ctx.beginPath(); ctx.arc(x,y,10,0,Math.PI*2);
    ctx.fillStyle= se.L<50 ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.9)';
    ctx.fill(); ctx.strokeStyle='#60a5fa'; ctx.lineWidth=2; ctx.stroke();
    ctx.fillStyle= se.L<50 ? 'white':'black';
    ctx.font='10px system-ui'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(String(se.L), x,y);
  }
}

// ---------- controls binding ----------
const controls={
  paletteK: $('#paletteK'), pieceCount: $('#pieceCount'), roughness: $('#roughness'), anaSize: $('#anaSize'),
  targetMode: $('#targetMode'), contrast: $('#contrast'), blur: $('#blur'),
  gridCols: $('#gridCols'), lWeight: $('#lWeight'), scale: $('#scale'), rotation: $('#rotation'),
  allowReuse: $('#allowReuse'), showSeams: $('#showSeams'), ignoreWhiteBg: $('#ignoreWhiteBg'), targetIsBW: $('#targetIsBW'),
};
function bindVal(input, labelId, fmt=v=>v){
  const el=document.getElementById(labelId);
  if(!el) return;
  const upd=()=> el.textContent = input.value==0 && labelId==='vGrid' ? 'auto' : fmt(input.value);
  input.addEventListener('input', upd); upd();
}
bindVal(controls.paletteK,'vPalette');
bindVal(controls.pieceCount,'vPieces');
bindVal(controls.roughness,'vRough', v=>Number(v).toFixed(2));
bindVal(controls.anaSize,'vAna');
bindVal(controls.contrast,'vContrast');
bindVal(controls.blur,'vBlur');
bindVal(controls.gridCols,'vGrid', v=> v==0?'auto':v);
bindVal(controls.lWeight,'vW', v=>Number(v).toFixed(2));
bindVal(controls.scale,'vScale', v=>Number(v).toFixed(2));
controls.targetMode.addEventListener('change', ()=>{
  const isUser=controls.targetMode.value==='seededUser';
  $('#seedHint').classList.toggle('hidden', !isUser);
  // seededUser: disable overlay file pick so canvas clicks place seeds; user can still drop or use URL
  targetFile.style.pointerEvents = isUser ? 'none' : 'auto';
  targetDrop.classList.toggle('seeded', isUser);
  if(isUser) drawSeedOverlays();
});
$('#targetIsBW').addEventListener('change', ()=>{ if(targetCanvas) refreshMap(); });

// ---------- tear ----------
async function doTear(){
  if(!sourceCanvas){ setStatus('Drop a source color image first.'); return; }
  btnTear.disabled=true; setStatus('Tearing… quantizing & Voronoi…');
  await new Promise(r=>setTimeout(r,30)); // yield
  try{
    const opts={
      paletteK: Number(controls.paletteK.value),
      pieceCount: Number(controls.pieceCount.value),
      roughness: Number(controls.roughness.value),
      anaSize: Number(controls.anaSize.value),
    };
    torn = await tearImage(sourceCanvas, opts);
    renderTray();
    setStatus(`Torn into ${torn.pieces.length} pieces (${opts.paletteK} shades). Now build target map & compose.`);
    // auto refresh map/compose if target exists
    if(targetCanvas) { refreshMap(); doCompose(false); }
  } catch(e){ console.error(e); setStatus('Tear failed: '+e.message); }
  finally{ btnTear.disabled=false; }
}
function renderTray(){
  trayEl.innerHTML='';
  paletteBar.innerHTML='';
  if(!torn) return;
  pieceCountLabel.textContent=`(${torn.pieces.length})`;
  for(const p of torn.palette){
    const s=document.createElement('span');
    s.style.background=`rgb(${p.r},${p.g},${p.b})`;
    s.title=`${p.r},${p.g},${p.b} L=${p.lab[0].toFixed(1)}`;
    paletteBar.appendChild(s);
  }
  for(const piece of torn.pieces){
    const d=document.createElement('div'); d.className='piece'; d.title=`L=${piece.lab[0].toFixed(1)} a=${piece.lab[1].toFixed(1)}`;
    const c=document.createElement('canvas'); c.width=56; c.height=56;
    const ctx=c.getContext('2d');
    ctx.fillStyle='#111'; ctx.fillRect(0,0,56,56);
    // draw scaled
    const s=Math.min(56/piece.canvas.width, 56/piece.canvas.height)*0.9;
    const w=piece.canvas.width*s, h=piece.canvas.height*s;
    ctx.drawImage(piece.canvas, (56-w)/2, (56-h)/2, w,h);
    d.appendChild(c);
    trayEl.appendChild(d);
  }
}

// ---------- target map ----------
function refreshMap(){
  if(!targetCanvas) return;
  const mode=controls.targetMode.value;
  const contrast=Number(controls.contrast.value);
  const blur=Number(controls.blur.value);
  // build small map for preview, but compose uses full target size
  // For accuracy, build at targetCanvas size capped
  const maxMapSide=720;
  const sc=Math.min(1, maxMapSide/Math.max(targetCanvas.width,targetCanvas.height));
  const mw=Math.max(1, Math.round(targetCanvas.width*sc)), mh=Math.max(1, Math.round(targetCanvas.height*sc));
  const tmp=document.createElement('canvas'); tmp.width=mw; tmp.height=mh;
  tmp.getContext('2d').drawImage(targetCanvas,0,0,mw,mh);
  brightnessMap = buildBrightnessMap(tmp, { mode, contrast, blur, seeds: [...seeds] });
  targetW=mw; targetH=mh;
  // we keep original targetCanvas for preview, but brightnessMap corresponds to mw*mh
  renderMapToCanvas(brightnessMap, mw,mh, mapCanvas);
  // also keep mapping for compose: we will compose at mw x mh then upscale to preview
  // store scale factor
  brightnessMap._w=mw; brightnessMap._h=mh;
}

// ---------- compose ----------
async function doCompose(showStatus=true){
  if(!torn){ setStatus('Tear source first.'); return; }
  if(!targetCanvas){ setStatus('Drop a target B&W image first.'); return; }
  if(!brightnessMap) refreshMap();
  btnCompose.disabled=true;
  if(showStatus) setStatus('Composing collage…');
  await new Promise(r=>setTimeout(r,20));
  try{
    // compose at map size for speed, then stretch to collageCanvas sized to map
    const outW=brightnessMap._w, outH=brightnessMap._h;
    const tmp=document.createElement('canvas');
    const opts={
      gridCols: Number(controls.gridCols.value),
      lWeight: Number(controls.lWeight.value),
      scale: Number(controls.scale.value),
      rotation: Number(controls.rotation.value),
      allowReuse: controls.allowReuse.checked,
      showSeams: controls.showSeams.checked,
      ignoreWhiteBg: controls.ignoreWhiteBg.checked,
    };
    compose(tmp, torn.pieces, brightnessMap, outW, outH, opts);
    // blit to visible collageCanvas at higher res (2x for crisp)
    const dpr=Math.min(2, window.devicePixelRatio||1);
    collageCanvas.width=outW*dpr; collageCanvas.height=outH*dpr;
    collageCanvas.style.width=outW+'px'; collageCanvas.style.height=outH+'px';
    const ctx=collageCanvas.getContext('2d');
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.imageSmoothingEnabled=true;
    ctx.drawImage(tmp,0,0,outW,outH);
    // keep tmp for export at 2x
    collageCanvas._exportCanvas=tmp;
    $('#collageInfo').textContent=`grid ${opts.gridCols||'auto'} · ${outW}×${outH} · L weight ${opts.lWeight}`;
    if(showStatus) setStatus(`Composed ${outW}×${outH}. Tweak knobs & re-compose.`);
  } catch(e){ console.error(e); setStatus('Compose failed: '+e.message); }
  finally{ btnCompose.disabled=false; }
}

btnTear.addEventListener('click', doTear);
btnCompose.addEventListener('click', ()=>{ refreshMap(); doCompose(true); });
// live re-compose on knob change if already composed
['gridCols','lWeight','scale','rotation','allowReuse','showSeams','ignoreWhiteBg'].forEach(id=>{
  const el=document.getElementById(id);
  el.addEventListener('change', ()=>{ if(torn && brightnessMap) doCompose(false); });
  if(el.type==='range') el.addEventListener('input', ()=>{ /* debounce */ });
});
controls.contrast.addEventListener('change', ()=>{ refreshMap(); if(torn) doCompose(false); });
controls.blur.addEventListener('change', ()=>{ refreshMap(); if(torn) doCompose(false); });
controls.targetMode.addEventListener('change', ()=>{ refreshMap(); if(torn) doCompose(false); });

// export
btnExport.addEventListener('click', ()=>{
  const src = collageCanvas._exportCanvas || collageCanvas;
  // export at 2x resolution for print
  const scale=2;
  const exp=document.createElement('canvas'); exp.width=src.width*scale; exp.height=src.height*scale;
  exp.getContext('2d').drawImage(src,0,0,exp.width,exp.height);
  const a=document.createElement('a');
  a.download='collage.png';
  a.href=exp.toDataURL('image/png');
  a.click();
  setStatus('Exported PNG.');
});

// demo: if no image, show placeholders
drawPreview(sourcePreview, null, sourceDrop);
drawPreview(targetPreview, null, targetDrop);
setStatus('Drop source + target, or fetch via URL. Then Tear → Compose.');

// expose for debugging
window._state={ get sourceCanvas(){return sourceCanvas}, get targetCanvas(){return targetCanvas}, get torn(){return torn} };

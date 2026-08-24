import { labDistance } from './color.js';

// Compose collage on outCanvas (target size)
// pieces: from tear.js (each has lab, canvas)
// brightnessMap: Float32Array w*h in L* 0-100
// targetCanvas: source of w/h for reference (used for aspect)
// opts: { gridCols (0=auto), lWeight, scale, rotation, allowReuse, showSeams, ignoreWhiteBg }

export function compose(outCanvas, pieces, brightnessMap, targetW, targetH, opts){
  const gridCols = opts.gridCols ?? 0;
  const lWeight = opts.lWeight ?? 0.85;
  const abWeight = 1 - lWeight*0.7; // keep some chroma influence but lower
  const scale = opts.scale ?? 1.0;
  const rotOpt = opts.rotation ?? 15;
  const allowReuse = opts.allowReuse ?? false;
  const showSeams = opts.showSeams ?? true;
  const ignoreWhiteBg = opts.ignoreWhiteBg ?? true;

  // auto grid: try to make cells roughly square and count ~= pieces
  const N = pieces.length;
  let cols, rows;
  if(gridCols>0){ cols=gridCols; rows=Math.ceil(targetH / (targetW/cols)); }
  else {
    const aspect = targetW/targetH;
    cols = Math.max(4, Math.round(Math.sqrt(N*aspect)));
    rows = Math.max(4, Math.round(N/cols));
    // adjust to cover canvas nicely: ensure cols*rows >= N or fills canvas
    // Instead of matching N, fill canvas grid; each cell gets a piece (reuse if needed)
    cols = Math.max(8, Math.min(40, cols));
    rows = Math.max(8, Math.min(40, Math.round(cols/aspect)));
  }
  const cellW = targetW/cols, cellH = targetH/rows;

  outCanvas.width = targetW;
  outCanvas.height = targetH;
  const ctx = outCanvas.getContext('2d');
  ctx.fillStyle = '#0b0e13';
  ctx.fillRect(0,0,targetW,targetH);

  // Precompute target cell average L
  const cells = [];
  for(let r=0;r<rows;r++){
    for(let c=0;c<cols;c++){
      const x0=Math.floor(c*cellW), y0=Math.floor(r*cellH);
      const x1=Math.min(targetW, Math.ceil((c+1)*cellW)), y1=Math.min(targetH, Math.ceil((r+1)*cellH));
      let sum=0, cnt=0;
      for(let y=y0;y<y1;y++) for(let x=x0;x<x1;x++){ sum+=brightnessMap[y*targetW+x]; cnt++; }
      const avgL = cnt? sum/cnt : 50;
      // ignore white background cell
      if(ignoreWhiteBg && avgL > 92) continue; // skip very bright cells -> leave paper bg
      cells.push({r,c,x0,y0,x1,y1,cx:(x0+x1)/2, cy:(y0+y1)/2, w:x1-x0,h:y1-y0, avgL});
    }
  }

  // For matching, sort cells dark->light for deterministic greedy
  cells.sort((a,b)=>a.avgL-b.avgL);

  // availability
  const used = new Set();
  const pieceByL = [...pieces].sort((a,b)=>a.lab[0]-b.lab[0]);

  function findBestPiece(targetL){
    let best=null, bestD=Infinity, bestIdx=-1;
    const pool = allowReuse ? pieces : pieces.filter((_,i)=>!used.has(i));
    const idxPool = allowReuse ? pieces.map((_,i)=>i) : pieces.map((_,i)=>i).filter(i=>!used.has(i));
    // To speed, we can early prune by L but N up to 600, cells up to 1200 => 720k distance calcs fine
    for(let k=0;k<pool.length;k++){
      const p=pool[k];
      // distance primarily on L, slight on chroma: we want neutral pieces to be flexible
      // For target, we have no chroma (grayscale), so we compare piece chroma distance to 0 (gray) weighted low
      // Equivalent to penalizing highly saturated pieces when target is mid-gray? Keep simple: only L distance + small saturation penalty
      const dL = Math.abs(p.lab[0] - targetL) * lWeight;
      const dC = Math.sqrt(p.lab[1]**2 + p.lab[2]**2) * (1-lWeight)*0.2; // prefer less saturated when weight low
      const d = dL + dC;
      if(d < bestD){ bestD=d; best=p; bestIdx=idxPool[k]; }
    }
    if(bestIdx!==-1 && !allowReuse) used.add(bestIdx);
    return best;
  }

  // Draw
  for(const cell of cells){
    const piece = findBestPiece(cell.avgL);
    if(!piece) continue;
    const cx=cell.cx, cy=cell.cy;
    const baseW = cell.w * scale, baseH = cell.h * scale;
    // piece canvas aspect
    const pw=piece.canvas.width, ph=piece.canvas.height;
    const fitScale = Math.min(baseW/pw, baseH/ph) * 0.96; // 0.96 leaves seam gap
    const drawW = pw * fitScale, drawH = ph * fitScale;
    const rot = rotOpt===0 ? 0 : (Math.random()*2-1)* (rotOpt*Math.PI/180);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    if(showSeams){
      ctx.shadowColor='rgba(0,0,0,0.65)';
      ctx.shadowBlur=6;
      ctx.shadowOffsetY=3;
    }
    // draw piece centered
    const jitterX = (Math.random()-0.5)* cell.w*0.08;
    const jitterY = (Math.random()-0.5)* cell.h*0.08;
    ctx.translate(jitterX, jitterY);
    // optional white paper under to simulate thickness
    if(showSeams){
      ctx.fillStyle='rgba(255,255,255,0.08)';
      ctx.fillRect(-drawW/2-1, -drawH/2-1, drawW+2, drawH+2);
    }
    ctx.drawImage(piece.canvas, -drawW/2, -drawH/2, drawW, drawH);
    // seam line faint
    if(showSeams){
      ctx.shadowColor='transparent';
      ctx.strokeStyle='rgba(0,0,0,0.18)';
      ctx.lineWidth=1;
      ctx.strokeRect(-drawW/2, -drawH/2, drawW, drawH);
    }
    ctx.restore();
  }

  return { cols, rows, drawn: cells.length, reused: allowReuse };
}

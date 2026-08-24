import { quantize } from './quantize.js';
import { rgbToLab } from './color.js';

// hash noise for roughness
function hash2(x,y){ const s=Math.sin(x*12.9898 + y*78.233)*43758.5453; return s-Math.floor(s); }
function smoothstep(t){ return t*t*(3-2*t); }
function valueNoise(x,y){
  const xi=Math.floor(x), yi=Math.floor(y);
  const xf=x-xi, yf=y-yi;
  const h00=hash2(xi,yi), h10=hash2(xi+1,yi), h01=hash2(xi,yi+1), h11=hash2(xi+1,yi+1);
  const u=smoothstep(xf), v=smoothstep(yf);
  const a=h00*(1-u)+h10*u, b=h01*(1-u)+h11*u;
  return a*(1-v)+b*v;
}
function fbm(x,y){
  let v=0, amp=0.5, freq=1;
  for(let i=0;i<3;i++){ v+=valueNoise(x*freq,y*freq)*amp; freq*=2; amp*=0.5; }
  return v;
}

/**
 * Tear source image into pieces grouped by color shade.
 * - quantize to palette k
 * - for each palette color, allocate piece count proportional to area
 * - within each color's pixel set, run Voronoi via random sub-seeds
 * - add ragged edge by perturbing border pixels
 * Returns { pieces, palette }
 * piece = { id, colorIdx, lab, r,g,b, bounds:{x0,y0,x1,y1,w,h}, canvas, pixelCount, avgLab }
 */
export async function tearImage(sourceCanvas, opts){
  const k = opts.paletteK ?? 8;
  const totalPieces = opts.pieceCount ?? 120;
  const roughness = opts.roughness ?? 0.55;
  const anaSize = opts.anaSize ?? 280;

  // downscale to anaSize for analysis (keep aspect)
  const sw = sourceCanvas.width, sh = sourceCanvas.height;
  const scale = Math.min(anaSize / sw, anaSize / sh, 1);
  const aw = Math.max(1, Math.round(sw*scale));
  const ah = Math.max(1, Math.round(sh*scale));
  const ana = document.createElement('canvas');
  ana.width=aw; ana.height=ah;
  const actx=ana.getContext('2d');
  actx.drawImage(sourceCanvas, 0,0, aw, ah);
  const imgData = actx.getImageData(0,0,aw,ah);
  const data = imgData.data;

  // quantize
  const { palette, labels } = quantize(data, aw, ah, k, { samples: 6000, iters: 10 });

  // count per palette
  const counts = new Array(k).fill(0);
  for(let i=0;i<labels.length;i++) counts[labels[i]]++;

  // allocate pieces per palette proportional
  const totalPixels = aw*ah;
  const piecesPerPalette = counts.map(c=> Math.max( (c/totalPixels)*totalPieces , 0));
  // ensure integer sum ~ totalPieces
  let sum = piecesPerPalette.reduce((a,b)=>a+b,0);
  // adjust largest
  const raw = piecesPerPalette.map(v=> Math.max(1, Math.round(v)) );
  // if some palette tiny (<1% area) -> still 1 piece, may overshoot; normalize
  let rawSum = raw.reduce((a,b)=>a+b,0);
  // scale down if overshoot
  if(rawSum > totalPieces){
    const factor = totalPieces / rawSum;
    for(let i=0;i<k;i++) raw[i]=Math.max(1, Math.round(raw[i]*factor));
    rawSum = raw.reduce((a,b)=>a+b,0);
  }
  // distribute remainder
  while(rawSum < totalPieces){
    let idx = counts.indexOf(Math.max(...counts));
    // find palette with largest fractional remainder
    let best=-1, bestF=-1;
    for(let i=0;i<k;i++){ const f=piecesPerPalette[i]-raw[i]; if(f>bestF){bestF=f; best=i;}}
    raw[best]++; rawSum++;
  }
  while(rawSum > totalPieces){
    let best=-1, bestF=Infinity;
    for(let i=0;i<k;i++){ if(raw[i]<=1) continue; const f=piecesPerPalette[i]-raw[i]; if(f<bestF){bestF=f;best=i;}}
    if(best===-1) break;
    raw[best]--; rawSum--;
  }

  // Build per-color pixel indices
  const perColorIndices = Array.from({length:k}, ()=>[]);
  for(let i=0;i<labels.length;i++) perColorIndices[labels[i]].push(i);

  // For each color, generate sub-seeds by sampling random pixel positions
  const pieces = [];
  let globalId=0;
  // full-res source for piece canvases: we will map ana pixels to full-res via scale
  // Instead of full-res extraction now, we store ana-space mask and later extract from sourceCanvas at full res by mapping
  for(let ci=0; ci<k; ci++){
    const nPieces = raw[ci];
    const indices = perColorIndices[ci];
    if(indices.length===0) continue;
    // pick nPieces seeds randomly from indices (without replacement, kmeans++ style could be better but random ok)
    const seeds = [];
    const used = new Set();
    // use spatially spread seeds: pick random, then farthest point sampling for better spread
    // start random
    seeds.push( indices[Math.floor(Math.random()*indices.length)] );
    used.add(seeds[0]);
    while(seeds.length < nPieces){
      // pick candidate farthest from existing seeds (approximate)
      let bestIdx=-1, bestDist=-1;
      // sample 20 candidates for speed
      for(let candTry=0;candTry<20;candTry++){
        const cand = indices[Math.floor(Math.random()*indices.length)];
        if(used.has(cand)) continue;
        const cx=cand%aw, cy=Math.floor(cand/aw);
        let minD=Infinity;
        for(const s of seeds){
          const sx=s%aw, sy=Math.floor(s/aw);
          const d=(cx-sx)**2 + (cy-sy)**2;
          if(d<minD) minD=d;
        }
        if(minD>bestDist){bestDist=minD; bestIdx=cand;}
      }
      if(bestIdx===-1) bestIdx = indices[Math.floor(Math.random()*indices.length)];
      seeds.push(bestIdx);
      used.add(bestIdx);
    }
    // assign each pixel in indices to nearest seed (Voronoi constrained to color)
    const seedPos = seeds.map(s=>[s%aw, Math.floor(s/aw)]);
    const assignment = new Map(); // pieceLocalIdx -> pixelIndices[]
    const localLists = Array.from({length:nPieces}, ()=>[]);
    for(const pix of indices){
      const x=pix%aw, y=Math.floor(pix/aw);
      let best=0, bestD=Infinity;
      for(let s=0;s<nPieces;s++){
        const [sx,sy]=seedPos[s];
        const d=(x-sx)**2 + (y-sy)**2;
        if(d<bestD){bestD=d; best=s;}
      }
      localLists[best].push(pix);
    }
    // create piece objects
    for(let li=0; li<nPieces; li++){
      const pixs = localLists[li];
      if(pixs.length===0) continue;
      // bounds
      let x0=aw, y0=ah, x1=-1, y1=-1;
      for(const p of pixs){
        const x=p%aw, y=Math.floor(p/aw);
        if(x<x0) x0=x; if(x>x1) x1=x; if(y<y0) y0=y; if(y>y1) y1=y;
      }
      const bw = x1-x0+1, bh = y1-y0+1;
      // add 1px padding for edge effect
      const pad = 2;
      // create mask set for quick lookup
      const set = new Set(pixs);
      // ragged perturbation: for border pixels, randomly erode/dilate a bit
      // We'll build an expanded mask with noise
      // Instead of complex morphology, we just keep original mask and will
      // slightly perturb edge when rendering via clipping wiggle (later).
      // For now piece canvas will be pixel-perfect mask scaled to full res.
      // Compute average color LAB from source's full res? Use palette color for avg but compute actual mean for better match.
      let sumR=0,sumG=0,sumB=0;
      for(const p of pixs){ const o=p*4; sumR+=data[o]; sumG+=data[o+1]; sumB+=data[o+2]; }
      const avgR=Math.round(sumR/pixs.length), avgG=Math.round(sumG/pixs.length), avgB=Math.round(sumB/pixs.length);
      const avgLab = rgbToLab(avgR,avgG,avgB);

      // Build piece canvas at full-res scale (or ana scale for preview). Use ana scale for speed, upscale later in composer
      // We'll store ana-scale canvas for tray preview; composer will map to target size.
      const c = document.createElement('canvas');
      c.width = bw + pad*2;
      c.height = bh + pad*2;
      const ctx=c.getContext('2d');
      // draw masked pixels: fill with source ana image cropped
      // putImageData approach: create ImageData
      const pieceImg = ctx.createImageData(c.width, c.height);
      // For each pixel in piece, copy from ana
      for(const p of pixs){
        const x=p%aw, y=Math.floor(p/aw);
        const o=p*4;
        const r=data[o], g=data[o+1], b=data[o+2], a=data[o+3];
        const dx = x - x0 + pad, dy = y - y0 + pad;
        const di = (dy*c.width + dx)*4;
        pieceImg.data[di]=r; pieceImg.data[di+1]=g; pieceImg.data[di+2]=b; pieceImg.data[di+3]=a;
      }
      // edge raggedness: perturb border pixels by randomly adding/removing edge noise
      if(roughness > 0.01){
        // identify border pixels: pixel in set but neighbor not in set
        const dirs=[[1,0],[-1,0],[0,1],[0,-1]];
        for(const p of [...pixs]){
          const x=p%aw, y=Math.floor(p/aw);
          let isBorder=false;
          for(const [dx,dy] of dirs){
            const nx=x+dx, ny=y+dy;
            if(nx<0||nx>=aw||ny<0||ny>=ah){ isBorder=true; break; }
            const nid=ny*aw+nx;
            if(!set.has(nid)){ isBorder=true; break; }
          }
          if(!isBorder) continue;
          const n = fbm(x*0.35, y*0.35); // 0-1
          const thresh = 0.35 + roughness*0.3; // higher roughness -> more erosion/dilation
          if(n > thresh){
            // erode: make transparent
            const dx=x-x0+pad, dy=y-y0+pad;
            const di=(dy*c.width+dx)*4;
            pieceImg.data[di+3]=0;
          } else if(n < 0.25 && roughness>0.6){
            // dilate: fill neighbor outside with same color (simple)
            for(const [dx,dy] of dirs){
              const nx=x+dx, ny=y+dy;
              if(nx<x0-pad||nx>x1+pad||ny<y0-pad||ny>y1+pad) continue;
              const nid=ny*aw+nx;
              if(set.has(nid)) continue;
              const di2=((ny-y0+pad)*c.width + (nx-x0+pad))*4;
              if(pieceImg.data[di2+3]===0 && Math.random()<0.4){
                const o=p*4;
                pieceImg.data[di2]=data[o]; pieceImg.data[di2+1]=data[o+1]; pieceImg.data[di2+2]=data[o+2]; pieceImg.data[di2+3]=200;
              }
            }
          }
        }
      }
      ctx.putImageData(pieceImg,0,0);

      pieces.push({
        id: globalId++,
        colorIdx: ci,
        r: avgR, g: avgG, b: avgB,
        lab: avgLab,
        bounds: { x0,y0,x1,y1,w:bw,h:bh, pad },
        canvas: c,
        pixelCount: pixs.length,
        paletteColor: palette[ci],
      });
    }
  }

  // sort tray by luminance (L*), then hue
  pieces.sort((a,b)=> a.lab[0]-b.lab[0] || a.lab[1]-b.lab[1]);

  // Also return fullRes blobs for composer scaling? For now ana canvases are sufficient.
  // Store meta for fullRes extraction if needed
  return { pieces, palette, aw, ah, sw, sh, sourceCanvas };
}

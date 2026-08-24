import { rgbToLab, applyContrast } from './color.js';

// Build brightness map Float32Array size w*h, values 0-100 (LAB L*)
// opts: { mode:'direct'|'seededAuto'|'seededUser', contrast, blur, ignoreWhiteBg, seeds: [{x,y,L}] }
// seeds for user mode are in canvas coordinates 0..w,0..h with L 0-100
export function buildBrightnessMap(targetCanvas, opts){
  const w=targetCanvas.width, h=targetCanvas.height;
  const ctx=targetCanvas.getContext('2d');
  const img=ctx.getImageData(0,0,w,h);
  const data=img.data;
  const out = new Float32Array(w*h);
  const contrast = opts.contrast ?? 0;
  const mode = opts.mode ?? 'direct';

  // helper to get L*
  function pixelL(i){
    const o=i*4;
    let r=data[o], g=data[o+1], b=data[o+2];
    if(contrast!==0){ r=applyContrast(r,contrast); g=applyContrast(g,contrast); b=applyContrast(b,contrast); }
    // if auto grayscale, use luminance, else use actual Lab from grayscale image (target is B&W anyway)
    const lab = rgbToLab(r,g,b);
    return lab[0]; // 0-100
  }

  if(mode === 'direct'){
    for(let i=0;i<w*h;i++) out[i]=pixelL(i);
  } else if(mode === 'seededAuto'){
    // auto seeds: pick darkest and lightest regions via quantiles
    const Ls = new Float32Array(w*h);
    for(let i=0;i<w*h;i++) Ls[i]=pixelL(i);
    // find thresholds: 10th and 90th percentile
    const sorted = Float32Array.from(Ls).sort();
    const darkThresh = sorted[Math.floor(sorted.length*0.12)];
    const lightThresh = sorted[Math.floor(sorted.length*0.88)];
    // build seeds as centroids of dark/light blobs (sample 80 points each)
    const darkSeeds=[], lightSeeds=[];
    for(let i=0;i<w*h;i++) if(Ls[i]<=darkThresh) darkSeeds.push(i);
    for(let i=0;i<w*h;i++) if(Ls[i]>=lightThresh) lightSeeds.push(i);
    // if sparse line-art, darkSeeds will be thin lines -> propagate via distance field
    const seeds = [];
    // sample at most 30 dark + 30 light as anchors
    const pick = (arr, n, Lval)=>{
      const step=Math.max(1, Math.floor(arr.length/n));
      for(let k=0;k<arr.length && seeds.length<n;k+=step){
        const idx=arr[k]; seeds.push({x: idx%w, y: Math.floor(idx/w), L: Lval});
      }
    };
    pick(darkSeeds, 20, 0);
    pick(lightSeeds, 20, 100);
    // if too few seeds, fallback to direct for those pixels? we do Voronoi interpolation
    interpolateFromSeeds(out, w,h, seeds, Ls);
  } else if(mode === 'seededUser'){
    const seeds = opts.seeds ?? [];
    if(seeds.length===0){
      for(let i=0;i<w*h;i++) out[i]=pixelL(i);
    } else {
      // build base map then overwrite with interpolated seeds influence?
      // For user mode, we interpolate seeds to fill whole canvas, ignoring original grays except as optional bias
      interpolateFromSeeds(out, w,h, seeds, null);
    }
  }

  // optional blur/diffuse (simple box blur iterations)
  const blur = opts.blur ?? 0;
  if(blur>0){
    const iters = Math.min(6, Math.max(1, Math.round(blur/2)));
    const radius = Math.max(1, Math.round(blur));
    boxBlur(out, w,h, radius, iters);
  }

  // ignore white background: mark bright areas as no-fill? We'll handle in composer, not map
  return out;
}

function interpolateFromSeeds(out, w,h, seeds, baseLs){
  // Inverse distance weighting (IDW) + falloff
  // For each pixel, compute weighted average of seed L by 1/(dist^p + eps)
  // p=2, with influence radius. For performance, we use brute force but w*h up to ~360*360=129k * 40 seeds =5M ok
  const p=1.8;
  for(let y=0;y<h;y++){
    for(let x=0;x<w;x++){
      let num=0, den=0;
      let minDist=Infinity, nearestL=50;
      for(const s of seeds){
        const dx=x-s.x, dy=y-s.y;
        const d=Math.sqrt(dx*dx+dy*dy)+1;
        if(d<minDist){minDist=d; nearestL=s.L;}
        const wgt = 1 / Math.pow(d, p);
        num += s.L * wgt;
        den += wgt;
      }
      let v = den>0 ? num/den : nearestL;
      // if baseLs provided (auto mode), blend with original 30% to keep structure
      if(baseLs){
        const idx=y*w+x;
        const base=baseLs[idx];
        v = v*0.65 + base*0.35;
      }
      out[y*w+x]=Math.max(0, Math.min(100, v));
    }
  }
}

function boxBlur(arr,w,h,radius,iters){
  const tmp=new Float32Array(arr.length);
  for(let iter=0; iter<iters; iter++){
    // horizontal
    for(let y=0;y<h;y++){
      let sum=0, count=0;
      for(let x=-radius;x<w+radius;x++){
        if(x+radius < w) { sum+=arr[y*w + Math.min(w-1, Math.max(0,x+radius))]; count++; }
        // not trivial sliding window due to edges; just naive for simplicity (w up to 400, radius <=12, cost fine)
      }
    }
    // naive: O(w*h*r^2) but w=360,r=6 => ~16M per iter okay
    for(let y=0;y<h;y++){
      for(let x=0;x<w;x++){
        let s=0,c=0;
        for(let dy=-radius; dy<=radius; dy++){
          const ny=y+dy; if(ny<0||ny>=h) continue;
          for(let dx=-radius; dx<=radius; dx++){
            const nx=x+dx; if(nx<0||nx>=w) continue;
            s+=arr[ny*w+nx]; c++;
          }
        }
        tmp[y*w+x]=s/c;
      }
    }
    arr.set(tmp);
  }
}

export function renderMapToCanvas(map,w,h, canvas){
  canvas.width=w; canvas.height=h;
  const ctx=canvas.getContext('2d');
  const img=ctx.createImageData(w,h);
  for(let i=0;i<w*h;i++){
    const v=Math.round(map[i]/100*255);
    img.data[i*4]=v; img.data[i*4+1]=v; img.data[i*4+2]=v; img.data[i*4+3]=255;
  }
  ctx.putImageData(img,0,0);
}

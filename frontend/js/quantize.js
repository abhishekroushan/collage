import { rgbToLab } from './color.js';

// k-means in LAB space. Input: Uint8ClampedArray rgba, length = w*h*4
// Returns { palette: [{r,g,b, lab}], labels: Uint16Array length N, paletteLAB: [] }

export function quantize(pixels, w, h, k=8, opts={}){
  const samples = opts.samples ?? 5000;
  const iters = opts.iters ?? 12;
  const N = w*h;
  // collect sample indices
  const idxs = [];
  if (N > samples){
    const used = new Set();
    while(idxs.length < samples){
      const r = Math.floor(Math.random()*N);
      if(!used.has(r)){ used.add(r); idxs.push(r); }
    }
  } else {
    for(let i=0;i<N;i++) idxs.push(i);
  }
  const sampleLabs = idxs.map(i=>{
    const o=i*4; return rgbToLab(pixels[o], pixels[o+1], pixels[o+2]);
  });
  const sampleRgbs = idxs.map(i=>{ const o=i*4; return [pixels[o], pixels[o+1], pixels[o+2]]; });

  // kmeans++ init
  const centers = [];
  const centerLabs = [];
  let first = Math.floor(Math.random()*sampleLabs.length);
  centers.push(sampleRgbs[first].slice());
  centerLabs.push(sampleLabs[first].slice());
  for(let c=1;c<k;c++){
    // distance to nearest center
    let dists = sampleLabs.map(l=>{
      let best=Infinity;
      for(const cl of centerLabs){
        const d = (l[0]-cl[0])**2 + (l[1]-cl[1])**2 + (l[2]-cl[2])**2;
        if(d<best) best=d;
      }
      return best;
    });
    const sum = dists.reduce((a,b)=>a+b,0);
    let r = Math.random()*sum;
    let pick=0;
    for(let i=0;i<dists.length;i++){ r-=dists[i]; if(r<=0){ pick=i; break; } }
    centers.push(sampleRgbs[pick].slice());
    centerLabs.push(sampleLabs[pick].slice());
  }

  let labelsSample = new Uint16Array(sampleLabs.length);
  for(let iter=0; iter<iters; iter++){
    // assign
    for(let i=0;i<sampleLabs.length;i++){
      const lab = sampleLabs[i];
      let best=0, bestD=Infinity;
      for(let c=0;c<k;c++){
        const cl=centerLabs[c];
        const d=(lab[0]-cl[0])**2 + (lab[1]-cl[1])**2 + (lab[2]-cl[2])**2;
        if(d<bestD){ bestD=d; best=c; }
      }
      labelsSample[i]=best;
    }
    // recompute
    const sums = Array.from({length:k},()=>[0,0,0,0]); // lab sums + count
    // we average in LAB then convert back? simpler average RGB then convert
    const rgbSums = Array.from({length:k},()=>[0,0,0,0]);
    for(let i=0;i<sampleLabs.length;i++){
      const c=labelsSample[i];
      rgbSums[c][0]+=sampleRgbs[i][0];
      rgbSums[c][1]+=sampleRgbs[i][1];
      rgbSums[c][2]+=sampleRgbs[i][2];
      rgbSums[c][3]++;
    }
    for(let c=0;c<k;c++){
      if(rgbSums[c][3]===0) continue;
      const r=Math.round(rgbSums[c][0]/rgbSums[c][3]);
      const g=Math.round(rgbSums[c][1]/rgbSums[c][3]);
      const b=Math.round(rgbSums[c][2]/rgbSums[c][3]);
      centers[c]=[r,g,b];
      centerLabs[c]=rgbToLab(r,g,b);
    }
  }

  // build final palette + LAB
  const palette = centers.map(([r,g,b])=>({r,g,b, lab: rgbToLab(r,g,b)}));
  const paletteLabs = palette.map(p=>p.lab);

  // assign all pixels (full res) to palette
  const labels = new Uint16Array(N);
  for(let i=0;i<N;i++){
    const o=i*4;
    const lab = rgbToLab(pixels[o], pixels[o+1], pixels[o+2]);
    let best=0,bestD=Infinity;
    for(let c=0;c<k;c++){
      const cl=paletteLabs[c];
      const d=(lab[0]-cl[0])**2 + (lab[1]-cl[1])**2 + (lab[2]-cl[2])**2;
      if(d<bestD){bestD=d; best=c}
    }
    labels[i]=best;
  }
  return { palette, labels, paletteLabs };
}

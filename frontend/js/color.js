// color utils: sRGB -> linear -> XYZ -> LAB, and helpers
// All functions operate on 0-255 sRGB

export function srgbToLinear(c){
  c/=255;
  return c<=0.04045 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4);
}
export function linearToSrgb(c){
  const v = c<=0.0031308 ? 12.92*c : 1.055*Math.pow(c,1/2.4)-0.055;
  return Math.min(255, Math.max(0, Math.round(v*255)));
}

// D65
export function rgbToXyz(r,g,b){
  const R=srgbToLinear(r), G=srgbToLinear(g), B=srgbToLinear(b);
  return [
    R*0.4124564 + G*0.3575761 + B*0.1804375,
    R*0.2126729 + G*0.7151522 + B*0.0721750,
    R*0.0193339 + G*0.1191920 + B*0.9503041,
  ];
}
export function xyzToLab(x,y,z){
  // reference white D65
  const Xn=0.95047, Yn=1.0, Zn=1.08883;
  function f(t){ return t>0.008856 ? Math.cbrt(t) : (7.787*t + 16/116); }
  const fx=f(x/Xn), fy=f(y/Yn), fz=f(z/Zn);
  return [116*fy-16, 500*(fx-fy), 200*(fy-fz)];
}
export function rgbToLab(r,g,b){
  const [x,y,z]=rgbToXyz(r,g,b);
  return xyzToLab(x,y,z);
}
export function labDistance(a,b,wL=1,wAB=1){
  // weighted: wL for L, wAB for a,b
  const dL=(a[0]-b[0])*wL, da=(a[1]-b[1])*wAB, db=(a[2]-b[2])*wAB;
  return Math.sqrt(dL*dL+da*da+db*db);
}
export function luminanceLab(lab){ return lab[0]; }
export function rgbToLuminance(r,g,b){
  // fast perceptual L* approx via lab L, but also simple
  return rgbToLab(r,g,b)[0];
}
export function applyContrast(v, contrast){
  // v in [0,255], contrast in [-100,100]
  const f = (259*(contrast+255))/(255*(259-contrast));
  return Math.min(255, Math.max(0, Math.round(f*(v-128)+128)));
}

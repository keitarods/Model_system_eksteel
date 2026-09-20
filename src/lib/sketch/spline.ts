import type { Point, SketchPoint, SplineShape } from "./types";
export type CubicControls = [Point, Point, Point, Point];

export function resolveSpline(shape: SplineShape, points: Record<string, SketchPoint>): CubicControls | null {
  const controls: CubicControls = [points[shape.p1], points[shape.control1], points[shape.control2], points[shape.p2]];
  return controls.every(Boolean) ? controls as CubicControls : null;
}

export function cubicPoint(controls: CubicControls, t: number): Point {
  const [a,b,c,d] = controls, u = 1-t;
  return { x:u*u*u*a.x+3*u*u*t*b.x+3*u*t*t*c.x+t*t*t*d.x,
    y:u*u*u*a.y+3*u*u*t*b.y+3*u*t*t*c.y+t*t*t*d.y };
}

/** Bounded adaptive tessellation for display only; BREP retains the cubic. */
export function sampleSpline(controls: CubicControls, tolerance = 0.05): Point[] {
  const output: Point[] = [controls[0]];
  const mid = (a:Point,b:Point):Point => ({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
  function split(p:CubicControls, depth:number) {
    const [a,b,c,d]=p;
    // Control polygon excess also catches collinear reversals and loops.
    const length = Math.hypot(b.x-a.x,b.y-a.y)+Math.hypot(c.x-b.x,c.y-b.y)+Math.hypot(d.x-c.x,d.y-c.y);
    const chordDistance=(p:Point)=>{
      const dx=d.x-a.x,dy=d.y-a.y,den=dx*dx+dy*dy;
      const t=den>0?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/den)):0;
      return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
    };
    if(depth===12 || (Math.max(chordDistance(b),chordDistance(c))<tolerance && length-Math.hypot(d.x-a.x,d.y-a.y)<tolerance)) {output.push(d);return;}
    const ab=mid(a,b),bc=mid(b,c),cd=mid(c,d),abc=mid(ab,bc),bcd=mid(bc,cd),center=mid(abc,bcd);
    split([a,ab,abc,center],depth+1);split([center,bcd,cd,d],depth+1);
  }
  split(controls,0);return output;
}

export function nearestSplinePoint(raw:Point, controls:CubicControls):Point {
  const distance=(t:number)=>{const p=cubicPoint(controls,t);return (p.x-raw.x)**2+(p.y-raw.y)**2;};
  let best=0;
  for(let i=1;i<=96;i++)if(distance(i/96)<distance(best))best=i/96;
  let lo=Math.max(0,best-1/96),hi=Math.min(1,best+1/96);
  for(let i=0;i<32;i++){const a=lo+(hi-lo)/3,b=hi-(hi-lo)/3;if(distance(a)<distance(b))hi=b;else lo=a;}
  const t=(lo+hi)/2;
  return cubicPoint(controls,distance(best)<distance(t)?best:t);
}

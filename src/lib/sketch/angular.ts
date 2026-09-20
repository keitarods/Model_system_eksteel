import type { LineShape, SketchPoint, Point } from "./types";
/** Directed angle from reference p1→p2 to dependent p1→p2, counterclockwise. */
export function angularTarget(a:LineShape,b:LineShape,points:Record<string,SketchPoint>,degrees:number):Point|null {
  const a1=points[a.p1],a2=points[a.p2],b1=points[b.p1],b2=points[b.p2];
  if(!a1||!a2||!b1||!b2||!Number.isFinite(degrees)||degrees<0||degrees>=360)return null;
  if(Math.hypot(a2.x-a1.x,a2.y-a1.y)<1e-9)return null;
  const length=Math.hypot(b2.x-b1.x,b2.y-b1.y);if(length<1e-9)return null;
  const angle=Math.atan2(a2.y-a1.y,a2.x-a1.x)+degrees*Math.PI/180;
  return {x:b1.x+length*Math.cos(angle),y:b1.y+length*Math.sin(angle)};
}

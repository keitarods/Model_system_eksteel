import type { Point } from "./types";
export function reflectPoint(point: Point, a: Point, b: Point): Point | null {
  const dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;
  if(length<1e-12)return null;
  const t=((point.x-a.x)*dx+(point.y-a.y)*dy)/length;
  return {x:2*(a.x+t*dx)-point.x,y:2*(a.y+t*dy)-point.y};
}

import type { DrawingView } from './types';
import type { FlatBendGeometry } from '@/lib/replicad/drawingBends';

/** Measure normal to the bend, from the closest outer extremity of the stock.
 * Taking the outermost intersection on each side excludes internal laser cuts.
 */
export function flatBendDimension(view: DrawingView, bend: FlatBendGeometry) {
  const l=bend.line,dx=l.x2-l.x1,dy=l.y2-l.y1,length=Math.hypot(dx,dy);
  if(length<1e-8)return bend.panel;
  const origin={x:(l.x1+l.x2)/2,y:(l.y1+l.y2)/2};
  const nx=-dy/length,ny=dx/length;
  const hits:number[]=[];
  for(const e of view.visibleLineEdges??view.lineEdges){
    const ex=e.x2-e.x1,ey=e.y2-e.y1,det=nx*ey-ny*ex;
    if(Math.abs(det)<1e-9)continue;
    const ax=e.x1-origin.x,ay=e.y1-origin.y;
    const t=(ax*ey-ay*ex)/det,u=(ax*ny-ay*nx)/det;
    if(u>=-1e-7&&u<=1+1e-7)hits.push(t);
  }
  const tau=2*Math.PI,positive=(a:number)=>(a%tau+tau)%tau;
  for(const arc of view.arcs??[]){
    const ax=arc.x-origin.x,ay=arc.y-origin.y,along=ax*nx+ay*ny;
    const discriminant=arc.radius**2-(ax*ax+ay*ay-along*along);
    if(discriminant< -1e-7)continue;
    const start=Math.atan2(arc.start.y-arc.y,arc.start.x-arc.x);
    const end=positive(Math.atan2(arc.end.y-arc.y,arc.end.x-arc.x)-start);
    const mid=positive(Math.atan2(arc.mid.y-arc.y,arc.mid.x-arc.x)-start);
    for(const t of [along-Math.sqrt(Math.max(0,discriminant)),along+Math.sqrt(Math.max(0,discriminant))]){
      const angle=positive(Math.atan2(origin.y+ny*t-arc.y,origin.x+nx*t-arc.x)-start);
      if(mid<=end ? angle<=end+1e-7 : angle>=end-1e-7)hits.push(t);
    }
  }
  const positiveHits=hits.filter(t=>t>1e-6),negativeHits=hits.filter(t=>t< -1e-6);
  if(!positiveHits.length||!negativeHits.length)return bend.panel;
  const a=Math.max(...positiveHits),b=Math.min(...negativeHits);
  const distance=a<=-b?a:b;
  return {x1:origin.x+nx*distance,y1:origin.y+ny*distance,x2:origin.x,y2:origin.y};
}

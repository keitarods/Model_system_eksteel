export type Point2 = {x:number;y:number};
export type ContourArc = {x:number;y:number;radius:number;start:Point2;mid:Point2;end:Point2};
export type ContourLine = {x1:number;y1:number;x2:number;y2:number};
/** Called only for CAD edges classified as circular, never fits splines/ellipses. */
export function circularArc(start:Point2,mid:Point2,end:Point2):ContourArc|null {
  const bx=mid.x-start.x,by=mid.y-start.y,cx=end.x-start.x,cy=end.y-start.y;
  const det=2*(bx*cy-by*cx);
  if(Math.abs(det)<1e-10) return null;
  const b2=bx*bx+by*by,c2=cx*cx+cy*cy;
  const x=start.x+(cy*b2-by*c2)/det,y=start.y+(bx*c2-cx*b2)/det;
  return {x,y,radius:Math.hypot(x-start.x,y-start.y),start,mid,end};
}
/** Recover theoretical sharp corners only when two straight edges join an arc tangentially. */
export function fullContourLines(lines:ContourLine[],arcs:ContourArc[]):ContourLine[] {
  const result=lines.map(e=>({...e}));
  const near=(a:Point2,b:Point2)=>Math.hypot(a.x-b.x,a.y-b.y)<1e-4;
  const ends=(e:ContourLine)=>[{x:e.x1,y:e.y1},{x:e.x2,y:e.y2}];
  for(const arc of arcs) {
    const matches=[arc.start,arc.end].map(p=>lines.map((e,i)=>({e,i,end:ends(e).findIndex(q=>near(p,q))})).filter(m=>m.end>=0));
    if(matches[0].length!==1||matches[1].length!==1) continue;
    const [a,b]=[matches[0][0],matches[1][0]];
    if(a.i===b.i) continue;
    const u={x:a.e.x2-a.e.x1,y:a.e.y2-a.e.y1},v={x:b.e.x2-b.e.x1,y:b.e.y2-b.e.y1};
    const tangent=(p:Point2,d:Point2)=>Math.abs((p.x-arc.x)*d.x+(p.y-arc.y)*d.y)/(arc.radius*Math.hypot(d.x,d.y))<1e-4;
    if(!tangent(arc.start,u)||!tangent(arc.end,v)) continue;
    // Orthogonal rounded corners preserve the side envelope. For oblique
    // corners, the sharp intersection is not the actual material extremity.
    if(Math.abs(u.x*v.x+u.y*v.y)/(Math.hypot(u.x,u.y)*Math.hypot(v.x,v.y))>1e-4) continue;
    const det=u.x*v.y-u.y*v.x;
    if(Math.abs(det)<1e-8) continue;
    const t=((b.e.x1-a.e.x1)*v.y-(b.e.y1-a.e.y1)*v.x)/det;
    const corner={x:a.e.x1+t*u.x,y:a.e.y1+t*u.y};
    if(Math.hypot(corner.x-arc.x,corner.y-arc.y)>arc.radius*10) continue;
    for(const m of [a,b]) {if(m.end===0){result[m.i].x1=corner.x;result[m.i].y1=corner.y;}else{result[m.i].x2=corner.x;result[m.i].y2=corner.y;}}
  }
  return result;
}

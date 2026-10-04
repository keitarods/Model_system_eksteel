import type {DrawingDimension} from './types';
import {dimensionText} from './angularDimensions';
export type SelectionPoint={x:number;y:number};
export function dimensionBounds(d:DrawingDimension){
 const points:SelectionPoint[]=[];
 let label:SelectionPoint;
 if(d.angular){const r=Math.max(6,Math.abs(d.offset));for(let i=0;i<=32;i++){const a=d.angular.start+d.angular.delta*i/32;points.push({x:d.x1+r*Math.cos(a),y:d.y1+r*Math.sin(a)});}const a=d.angular.start+d.angular.delta/2;label={x:d.x1+(r+4)*Math.cos(a),y:d.y1+(r+4)*Math.sin(a)};}
 else{const l=Math.hypot(d.x2-d.x1,d.y2-d.y1)||1,nx=-(d.y2-d.y1)/l,ny=(d.x2-d.x1)/l;points.push({x:d.x1+nx*d.offset,y:d.y1+ny*d.offset},{x:d.x2+nx*d.offset,y:d.y2+ny*d.offset});label={x:(points[0].x+points[1].x)/2,y:(points[0].y+points[1].y)/2};}
 const w=Math.max(16,dimensionText(d,Math.hypot(d.x2-d.x1,d.y2-d.y1)).length*2);
 points.push({x:label.x-w/2,y:label.y-3.5},{x:label.x+w/2,y:label.y+3.5});
 return {x:Math.min(...points.map(p=>p.x)),y:Math.min(...points.map(p=>p.y)),right:Math.max(...points.map(p=>p.x)),bottom:Math.max(...points.map(p=>p.y))};
}
export function windowDimensions(dims:DrawingDimension[],a:SelectionPoint,b:SelectionPoint){
 const r={x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),right:Math.max(a.x,b.x),bottom:Math.max(a.y,b.y)};
 return dims.filter(d=>{const v=dimensionBounds(d);return b.x>=a.x?v.x>=r.x&&v.right<=r.right&&v.y>=r.y&&v.bottom<=r.bottom:v.right>=r.x&&v.x<=r.right&&v.bottom>=r.y&&v.y<=r.bottom;}).map(d=>d.id);
}
export function draggedDimensionOffset(d:DrawingDimension,dx:number,dy:number){
 if(d.angular){const a=d.angular.start+d.angular.delta/2;return Math.max(6,Math.abs(d.offset)+dx*Math.cos(a)+dy*Math.sin(a));}
 const l=Math.hypot(d.x2-d.x1,d.y2-d.y1)||1;return d.offset+dx*-(d.y2-d.y1)/l+dy*(d.x2-d.x1)/l;
}

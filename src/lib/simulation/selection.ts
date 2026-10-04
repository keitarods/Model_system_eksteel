import type {FeaMesh} from './types';
export type FaceBoundary={id:string;faceIds:number[];segments:[number,number][];length:number};
/** Boundary polylines from face triangulations, excluding internal mesh diagonals. */
export function faceBoundaries(mesh:FeaMesh):FaceBoundary[]{
 const segments=new Map<string,{nodes:[number,number];faces:number[]}>();
 for(const face of mesh.faces){
  const counts=new Map<string,{nodes:[number,number];count:number}>();
  for(const tri of face.triangles)for(let i=0;i<3;i++){
   const a=tri[i],b=tri[(i+1)%3],nodes:[number,number]=a<b?[a,b]:[b,a],key=nodes.join(':');
   const old=counts.get(key);if(old)old.count++;else counts.set(key,{nodes,count:1});
  }
  for(const [key,value] of counts)if(value.count===1){const old=segments.get(key);if(old)old.faces.push(face.id);else segments.set(key,{nodes:value.nodes,faces:[face.id]});}
 }
 const groups=new Map<string,[number,number][]>();
 for(const s of segments.values()){const key=s.faces.sort((a,b)=>a-b).join(':');const list=groups.get(key)??[];list.push(s.nodes);groups.set(key,list);}
 const result:FaceBoundary[]=[];
 for(const [key,list] of groups){
  const adjacency=new Map<number,number[]>();list.forEach(([a,b],i)=>{for(const n of [a,b])adjacency.set(n,[...(adjacency.get(n)??[]),i]);});
  const visited=new Set<number>();
  list.forEach((_,index)=>{if(visited.has(index))return;const queue=[index],part:[number,number][]=[];visited.add(index);
   while(queue.length){const segment=list[queue.pop()!];part.push(segment);for(const node of segment)for(const next of adjacency.get(node)??[])if(!visited.has(next)){visited.add(next);queue.push(next);}}
   const length=part.reduce((sum,[a,b])=>sum+Math.hypot(...mesh.nodes[a].map((v,i)=>v-mesh.nodes[b][i])),0);
   result.push({id:`${key}/${index}`,faceIds:key.split(':').map(Number),segments:part,length});
  });
 }
 return result;
}
export function selectReference<T>(selected:T[],id:T,additive:boolean):T[]{
 return additive?(selected.includes(id)?selected.filter(value=>value!==id):[...selected,id]):[id];
}

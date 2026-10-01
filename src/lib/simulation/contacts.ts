import type {FeaMesh} from './types';

/** Suggestions only: the solver checks nodes, coverage, planarity and supports. */
export function suggestBondedPairs(mesh:FeaMesh):[number,number][]{
  const pairs:[number,number][]=[];
  const buckets=new Map<string,FeaMesh['faces']>();
  const cell=1e-6;
  for(const face of mesh.faces){
    if(!face.bodyId||!face.normal)continue;
    const cellIndex=face.center.map(v=>Math.floor(v/cell));
    for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++){
      const neighbors=buckets.get([cellIndex[0]+x,cellIndex[1]+y,cellIndex[2]+z].join(','))??[];
      for(const other of neighbors){
        if(face.bodyId===other.bodyId||Math.abs(face.area-other.area)>Math.max(face.area,other.area)*1e-6)continue;
        if(Math.hypot(...face.center.map((v,k)=>v-other.center[k]))>cell)continue;
        if(face.normal.reduce((sum,v,k)=>sum+v*other.normal![k],0)>-.999999)continue;
        pairs.push(face.triangles.length<=other.triangles.length?[face.id,other.id]:[other.id,face.id]);
        if(pairs.length===100)return pairs;
      }
    }
    const key=cellIndex.join(',');const bucket=buckets.get(key)??[];bucket.push(face);buckets.set(key,bucket);
  }
  return pairs;
}

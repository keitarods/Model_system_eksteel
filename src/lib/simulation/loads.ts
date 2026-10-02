import type {Load, FeaMesh} from './types';

/** Resolve normal force to uniform traction using the current loaded area (N/mm²). */
export function solverLoads(loads:Load[],mesh:FeaMesh):Load[]{
  return loads.map(load=>{
    if(load.kind!=='force'||load.direction!=='normal')return load;
    if(!Number.isFinite(load.magnitude)||load.magnitude!<=0)throw new Error('Informe uma intensidade de força maior que zero.');
    let area=0;
    for(const id of new Set(load.faceIds)){
      const face=mesh.faces.find(f=>f.id===id);
      if(!face)throw new Error('Face carregada não encontrada.');
      for(const tri of face.loadTriangles??face.triangles){
        const a=mesh.nodes[tri[0]],b=mesh.nodes[tri[1]],c=mesh.nodes[tri[2]];
        const u=b.map((v,i)=>v-a[i]),v=c.map((x,i)=>x-a[i]);
        area+=Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])/2;
      }
    }
    if(!Number.isFinite(area)||area<=0)throw new Error('Área carregada inválida.');
    return {...load,kind:'pressure',pressure:load.magnitude!/area*(load.inverted?-1:1)};
  });
}

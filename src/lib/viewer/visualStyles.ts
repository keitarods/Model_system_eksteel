import type {ShapeMesh} from 'replicad';

export const VISUAL_STYLES = [
  {id:'realistic', label:'Realista', faces:true, edges:false, hidden:'none'},
  {id:'shaded', label:'Sombreado', faces:true, edges:false, hidden:'none'},
  {id:'shadedEdges', label:'Sombreado com arestas', faces:true, edges:true, hidden:'none'},
  {id:'shadedHidden', label:'Sombreado com arestas ocultas', faces:true, edges:true, hidden:'dashed'},
  {id:'wireframe', label:'Aramado', faces:false, edges:true, hidden:'solid'},
  {id:'wireframeHidden', label:'Aramado com arestas ocultas', faces:false, edges:true, hidden:'dashed'},
  {id:'wireframeVisible', label:'Aramado com arestas visíveis', faces:false, edges:true, hidden:'none'},
  {id:'monochrome', label:'Monocromático', faces:true, edges:false, hidden:'none'},
] as const;
export type VisualStyle = typeof VISUAL_STYLES[number]['id'];
export function isVisualStyle(value:unknown):value is VisualStyle {
  return VISUAL_STYLES.some(style=>style.id===value);
}
export function visualStyleSettings(style:VisualStyle){
  return VISUAL_STYLES.find(item=>item.id===style)??VISUAL_STYLES[0];
}

/** CAD edges, with a face-boundary fallback for imported meshes without topology.
 * Internal triangulation diagonals are never used as model edges.
 */
export function modelEdgePositions(mesh:ShapeMesh&{cadEdges?:{lines:number[]}}):number[]{
  if(mesh.cadEdges?.lines.length)return mesh.cadEdges.lines;
  const key=(index:number)=>mesh.vertices.slice(index*3,index*3+3).map(n=>n.toPrecision(12)).join(',');
  const segments=new Map<string,[number,number]>();
  for(const face of mesh.faceGroups){
    const counts=new Map<string,{nodes:[number,number];count:number}>();
    for(let i=face.start;i<face.start+face.count;i+=3)for(let j=0;j<3;j++){
      const a=mesh.triangles[i+j],b=mesh.triangles[i+(j+1)%3],ka=key(a),kb=key(b);
      if(ka===kb)continue;
      const id=ka<kb?`${ka}/${kb}`:`${kb}/${ka}`;
      const old=counts.get(id);
      if(old)old.count++;else counts.set(id,{nodes:[a,b],count:1});
    }
    for(const [id,entry] of counts)if(entry.count===1)segments.set(id,entry.nodes);
  }
  return [...segments.values()].flatMap(pair=>pair.flatMap(index=>mesh.vertices.slice(index*3,index*3+3)));
}

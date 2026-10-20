import type { SketchPlane } from '../sketch/types';
import { pointOnFlange, undoFlattenChain, undoFlattenChainDir, type FlattenLink } from './sheetMetal';
type Vec = [number, number, number];
const sub = (a: Vec,b: Vec): Vec => a.map((v,i)=>v-b[i]) as Vec;
const dot = (a: Vec,b: Vec) => a.reduce((sum,v,i)=>sum+v*b[i],0);

/** Locate a planar feature on an existing straight panel and carry its frame to flat.
 * Use a panel anchor: a sketch origin may lie outside the physical panel or bend. */
export function flatSketchPlane(plane: SketchPlane, chains: FlattenLink[][], allowInsideThickness = false): {plane: SketchPlane; chain: FlattenLink[]} {
  const matches: {plane: SketchPlane; chain: FlattenLink[]}[] = [];
  for (const chain of chains) {
    if (!chain.length) continue;
    const link = chain[chain.length-1];
    const anchor = pointOnFlange(link,[.5,.5,0]);
    const normalOffset = sub(pointOnFlange(link,[.5,.5,-1]),anchor);
    const normal = normalOffset.map(v=>v/link.thickness) as Vec;
    if (Math.abs(Math.abs(dot(normal,plane.normal))-1)>1e-6) continue;
    const distance = dot(sub(plane.origin,anchor),normal);
    const onSurface = Math.abs(distance) <= 1e-5 || Math.abs(distance-link.thickness) <= 1e-5;
    const insideSheet = distance >= -1e-5 && distance <= link.thickness + 1e-5;
    if (!onSurface && !(allowInsideThickness && insideSheet)) continue;
    const flatAnchor = undoFlattenChain(chain,anchor);
    const delta = undoFlattenChainDir(chain,sub(plane.origin,anchor));
    matches.push({chain,plane:{origin:flatAnchor.map((v,i)=>v+delta[i]) as Vec,
      normal:undoFlattenChainDir(chain,plane.normal),xDir:undoFlattenChainDir(chain,plane.xDir)}});
  }
  if (!matches.length) return {plane,chain:[]};
  const first = matches[0];
  if (matches.some(m=>['origin','normal','xDir'].some(key=>Math.hypot(...sub(m.plane[key as keyof SketchPlane] as Vec,first.plane[key as keyof SketchPlane] as Vec))>1e-5))) {
    throw new Error('Plano de esboço associado a mais de uma dobra. A planificação requer uma referência de face inequívoca.');
  }
  return first;
}

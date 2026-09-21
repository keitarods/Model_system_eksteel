const {test}=require('node:test');const assert=require('node:assert/strict');
const {findClickedEdge,findEdgesByPoints}=require('../src/lib/replicad/edgeTools.ts');
const {rebuildModel}=require('../src/lib/replicad/build-model.ts');
test('multi-edge fillet resolves only selected edges and reports invalid radii without changing input',async()=>{
 await require('./kernel.cjs')();const r=require('replicad');
 const box=r.makeBox([0,0,0],[20,20,20]);
 try {
  const hit=findClickedEdge(box,[0.01,0,0.01]);assert.ok(hit);
  const matched=findEdgesByPoints(box,[hit.point,hit.point]);assert.equal(matched.length,1);matched.forEach(e=>e.delete());
  assert.throws(()=>findEdgesByPoints(box,[[0,0,0]]),/ambígua/);
  const base={id:'base',type:'imported',label:'box',format:'step',brep:box.serialize()};
  const feature={id:'fillet',type:'fillet',label:'round',radius:1,edgePoints:[[0,0,10],[20,0,10],[20,20,10]]};
  const rounded=rebuildModel([base,feature]);try{assert.ok(rounded.mesh().triangles.length);assert.ok(r.measureVolume(rounded)<8000);}finally{rounded.delete();}
  const corner=rebuildModel([base,{...feature,edgePoints:[[10,0,0],[0,10,0],[0,0,10]]}]);
  try{assert.ok(corner.mesh().triangles.length);}finally{corner.delete();}
  assert.throws(()=>rebuildModel([base,{...feature,radius:100}]),/Não foi possível arredondar/);
  assert.ok(Math.abs(r.measureVolume(box)-8000)<1e-6);
 } finally {box.delete();}
});

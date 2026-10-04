const {test}=require('node:test');const assert=require('node:assert/strict');
const {toggleCadReference}=require('../src/components/viewer/CadSelection.tsx');
const {cadEdgeCoordinates}=require('../src/lib/replicad/selectionEdges.ts');
test('CAD references remain distinct across components and selection filters',()=>{
 const a={key:'a/face/1',owner:'a',kind:'face',id:1,label:'Face 1'},b={...a,key:'b/face/1',owner:'b'},edge={...a,key:'a/edge/1',kind:'edge'};
 assert.deepEqual(toggleCadReference([a],b,false),[b]);assert.deepEqual(toggleCadReference([a],b,true),[a,b]);
 assert.deepEqual(toggleCadReference([a,b],a,true),[b]);assert.deepEqual(toggleCadReference([a],edge,true),[a,edge]);
});
test('native CAD edge groups use vertex offsets and include complete polylines',async()=>{
 await require('./kernel.cjs')();const r=require('replicad');const solid=r.makeBox([0,0,0],[10,20,30]);
 try{solid.mesh();const edges=solid.meshEdges();assert.equal(edges.edgeGroups.length,12);let total=0;
 for(const group of edges.edgeGroups){const xyz=cadEdgeCoordinates(edges.lines,group);assert.equal(xyz.length,6);assert.ok(xyz.every(Number.isFinite));total+=Math.hypot(xyz[3]-xyz[0],xyz[4]-xyz[1],xyz[5]-xyz[2]);}
 assert.ok(Math.abs(total-240)<1e-7);
 }finally{solid.delete();}
});

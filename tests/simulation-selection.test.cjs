const {test}=require('node:test');const assert=require('node:assert/strict');
const {faceBoundaries,selectReference}=require('../src/lib/simulation/selection.ts');
test('face contours exclude internal triangulation diagonals',()=>{
 const mesh={nodes:[[0,0,0],[1,0,0],[1,1,0],[0,1,0]],faces:[{id:1,triangles:[[0,1,2],[0,2,3]]}]};
 const edges=faceBoundaries(mesh);assert.equal(edges.length,1);assert.equal(edges[0].segments.length,4);assert.equal(edges[0].length,4);assert.deepEqual(edges[0].faceIds,[1]);assert.ok(!edges[0].segments.some(([a,b])=>a===0&&b===2));
});
test('shared boundaries identify adjacent faces, keeping disconnected contours separate',()=>{
 const mesh={nodes:[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[2,0,0],[2,1,0]],faces:[{id:1,triangles:[[0,1,2],[0,2,3]]},{id:2,triangles:[[1,4,5],[1,5,2]]}]};
 const shared=faceBoundaries(mesh).filter(e=>e.faceIds.length===2);assert.equal(shared.length,1);assert.deepEqual(shared[0].faceIds,[1,2]);assert.equal(shared[0].length,1);
 const disconnected={nodes:mesh.nodes,faces:[{id:1,triangles:[[0,1,3],[2,4,5]]}]};assert.equal(faceBoundaries(disconnected).length,2);
});
test('plain click replaces selection while modifiers add or remove it',()=>{
 assert.deepEqual(selectReference([1,2],3,false),[3]);assert.deepEqual(selectReference([1],1,false),[1]);
 assert.deepEqual(selectReference([1],2,true),[1,2]);assert.deepEqual(selectReference([1,2],1,true),[2]);
});

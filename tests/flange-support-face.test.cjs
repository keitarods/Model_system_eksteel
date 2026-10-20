const {test}=require('node:test');const assert=require('node:assert/strict');
test('a nearby larger face cannot steal a flange edge from its actual support',async()=>{
 await require('./kernel.cjs')();const {makeBox,makeCompound}=require('replicad');
 const {findMainFaceForEdge}=require('../src/lib/replicad/edgeTools.ts');
 const solid=makeCompound([makeBox([-100,-2.5,-100],[100,-.5,100]),makeBox([101,-2,0],[103,0,30])]);
 try {
  const face=findMainFaceForEdge(solid,[103,-2,0],[103,-2,30],[0,1,0]);
  assert.ok(face);assert.ok(Math.abs(face.center[1]+2)<1e-6);assert.ok(Math.abs(face.normal[1]+1)<1e-6);
  assert.equal(findMainFaceForEdge(solid,[105,-2,0],[105,-2,30]),null);
 }finally{solid.delete();}
});

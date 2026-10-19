const {test}=require('node:test');
const assert=require('node:assert/strict');
const {IMPORTED_DISPLAY_OPTIONS}=require('../src/lib/replicad/displayQuality.ts');
test('import display levels preserve curved solid geometry and faces while reducing triangles',async()=>{
 await require('./kernel.cjs')();const r=require('replicad');
 const counts={};let expectedFaces;
 for(const [quality,options] of Object.entries(IMPORTED_DISPLAY_OPTIONS)){
  const solid=r.drawCircle(10).sketchOnPlane('XY').extrude(20);
  try {
   const volume=r.measureVolume(solid),area=r.measureArea(solid);
   const mesh=solid.mesh(options);counts[quality]=mesh.triangles.length;
   expectedFaces??=mesh.faceGroups.length;
   assert.equal(mesh.faceGroups.length,expectedFaces);
   assert.ok(Math.abs(r.measureVolume(solid)-volume)<1e-7);
   assert.ok(Math.abs(r.measureArea(solid)-area)<1e-7);
   assert.ok(mesh.triangles.every(i=>i>=0&&i<mesh.vertices.length/3));
  }finally{solid.delete();}
 }
 assert.ok(counts.fast<counts.fine);
 assert.ok(counts.balanced<=counts.fine);
});

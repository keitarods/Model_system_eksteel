const {test}=require('node:test');const assert=require('node:assert/strict');
const {hitsSketchSupport}=require('../src/components/viewer/planePickPriority.ts');
test('model face wins over overlapping origin planes, regardless of hit ordering',()=>{
 const plane={object:{userData:{}}},face={object:{userData:{sketchSupport:true}}};
 assert.equal(hitsSketchSupport([plane,face]),true);
 assert.equal(hitsSketchSupport([face,plane]),true);
 assert.equal(hitsSketchSupport([plane]),false);
});
test('Face uses the exact offset sketch plane without snapping to the origin plane',async()=>{
 await require('./kernel.cjs')();const {rebuildModel}=require('../src/lib/replicad/build-model.ts');
 const {sketchPlaneFromHit}=require('../src/lib/replicad/plane.ts');
 for(const direction of ['normal','flipped','symmetric']) {
  const plane=sketchPlaneFromHit([0,-.5,0],[0,1,0]);
  const solid=rebuildModel([{id:'rule',type:'sheetMetal',label:'Chapa',thickness:2},{id:'face',type:'face',label:'Face',plane,direction,profile:{kind:'rect',x1:0,y1:0,x2:10,y2:20}}]);
  try {
   const values=solid.mesh().vertices.filter((_,i)=>i%3===1);
   const min=direction==='flipped'?-2.5:direction==='symmetric'?-1.5:-.5;
   assert.ok(Math.abs(Math.min(...values)-min)<1e-6);
   assert.ok(Math.abs(Math.max(...values)-(min+2))<1e-6);
  }finally{solid.delete();}
 }
});

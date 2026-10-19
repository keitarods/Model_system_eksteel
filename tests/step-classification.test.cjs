const {test}=require('node:test');
const assert=require('node:assert/strict');
const {classifyStepBodies}=require('../src/lib/simulation/stepClassification.ts');
const {emptyStudy}=require('../src/lib/simulation/types.ts');
const {parseStudy,serializeStudy}=require('../src/lib/simulation/format.ts');
test('STEP suggests part or assembly from solids without changing geometry or assuming bonds',async()=>{
 await require('./kernel.cjs')();const r=require('replicad');
 for(const count of [1,6]){
  const bodies=Array.from({length:count},(_,i)=>r.makeBox([i*20,0,0],[i*20+10,10,10]));
  const shape=count===1?bodies[0]:r.compoundShapes(bodies);
  try {
   const before=r.measureVolume(shape),result=classifyStepBodies(shape);
   assert.equal(result.geometryMode,count===1?'part':'assemblyBonded');
   assert.equal(result.components.length,count);
   assert.equal(new Set(result.components.map(c=>c.id)).size,count);
   assert.equal(result.preparation.unite,false);
   assert.equal(result.preparation.closeGaps,false);
   assert.ok(Math.abs(r.measureVolume(shape)-before)<1e-8);
   const study={...emptyStudy(),...result};
   const loaded=parseStudy(serializeStudy(study));
   assert.deepEqual(loaded.components,result.components);
   assert.deepEqual(loaded.preparation,result.preparation);
  }finally{shape.delete();}
 }
 const wire=r.drawRectangle(10,10).sketchOnPlane('XY').wire;
 try{assert.throws(()=>classifyStepBodies(wire),/não contém sólidos/);}finally{wire.delete();}
});

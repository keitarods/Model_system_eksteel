const {test}=require('node:test');
const assert=require('node:assert/strict');
const {meshStudyWithBodyCount}=require('../src/lib/simulation/meshGeometryMode.ts');
const {emptyStudy}=require('../src/lib/simulation/types.ts');
test('legacy multi-solid part studies use assembly meshing without automatic union',()=>{
 const original={...emptyStudy(),step:'original STEP',geometryMode:'part'};
 delete original.preparation;
 const adjusted=meshStudyWithBodyCount(original,6);
 assert.equal(adjusted.geometryMode,'assemblyBonded');
 assert.equal(adjusted.preparation.unite,false);
 assert.equal(adjusted.step,original.step);
 assert.equal(original.geometryMode,'part');
 assert.equal(meshStudyWithBodyCount(original,1),original);
});
test('mode correction preserves explicit preparation, loads and supports',()=>{
 const original={...emptyStudy(),geometryMode:'part',preparation:{heal:true,removeSmall:false,closeGaps:true,unite:true,tolerance:0.01}};
 const adjusted=meshStudyWithBodyCount(original,6);
 assert.equal(adjusted.preparation,original.preparation);
 assert.equal(adjusted.supports,original.supports);
 assert.equal(adjusted.loads,original.loads);
 assert.equal(meshStudyWithBodyCount(adjusted,6),adjusted);
});

const {test}=require('node:test');const assert=require('node:assert/strict');
const {convergenceRow,hasConverged,refinedStudy,verifyFaceReferences}=require('../src/lib/simulation/convergence.ts');
const {emptyStudy}=require('../src/lib/simulation/types.ts');
const mesh={size:10,nodes:Array(10),tetrahedra:Array(2),faces:[{id:1,area:10,center:[0,0,0]}],regions:[{id:1,volume:10,center:[0,0,0]}]};
const result=(u,s,e)=>({summary:{maxDisplacement:u,maxVonMises:s,strainEnergy:e}});
test('convergence requires two successive refinements in all three metrics',()=>{
 const a=convergenceRow(mesh,result(1,10,100));
 const b=convergenceRow(mesh,result(1.01,10.1,101),a);
 const c=convergenceRow(mesh,result(1.02,10.2,102),b);
 assert.equal(hasConverged([a,b],5),false);assert.equal(hasConverged([a,b,c],5),true);
 const singular=convergenceRow(mesh,result(1.021,30,102.1),c);
 assert.equal(hasConverged([a,b,c,singular],5),false);
 assert.throws(()=>convergenceRow(mesh,result(1,10,undefined)),/energia/);
});
test('refinement scales all size controls while preserving physics',()=>{
 const s={...emptyStudy(),size:10,meshControls:{minimumSize:2,curvature:20,qualityTarget:.3},refinements:[{faceId:1,size:1}],regionMaterials:{'1':emptyStudy().material}};
 const r=refinedStudy(s);assert.equal(r.size,7);assert.equal(r.meshControls.minimumSize,1.4);assert.equal(r.refinements[0].size,.7);assert.deepEqual(r.regionMaterials,s.regionMaterials);
 assert.throws(()=>refinedStudy({...s,size:.01}),/mínimo/);
});
test('refinement rejects reused face and body tags when geometry changes',()=>{
 const s={...emptyStudy(),supports:[{faceIds:[1]}],regionMaterials:{'1':emptyStudy().material}};
 verifyFaceReferences(mesh,mesh,s);
 assert.throws(()=>verifyFaceReferences(mesh,{...mesh,faces:[{id:1,area:11,center:[0,0,0]}]},s),/faces/);
 assert.throws(()=>verifyFaceReferences(mesh,{...mesh,regions:[{id:1,volume:20,center:[0,0,0]}]},s),/corpos/);
});

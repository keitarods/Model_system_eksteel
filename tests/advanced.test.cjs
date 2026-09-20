const {test}=require('node:test');const assert=require('node:assert/strict');
const {rebuildModel}=require('../src/lib/replicad/build-model.ts');
const {serializeProject,parseProject}=require('../src/lib/project/nativeFormat.ts');
const plane=z=>({origin:[0,0,z],normal:[0,0,1],xDir:[1,0,0]});
const section=(id,z,r)=>({id,type:'sketch',label:id,plane:plane(z),points:{c:{id:'c',x:0,y:0}},shapes:[{id:id+'c',type:'circle',center:'c',radius:r}],dimensions:[]});
test('real kernel loft rebuild, native round trip and inward shell',async()=>{
 await require('./kernel.cjs')();
 const features=[section('s1',0,20),section('s2',40,20),{id:'loft',type:'loft',label:'Loft',sectionIds:['s1','s2'],ruled:false}];
 const loft=rebuildModel(features);assert.ok(loft.mesh().triangles.length>0);assert.ok(Math.abs(require('replicad').measureVolume(loft)-Math.PI*400*40)<1e-4);loft.delete();
 const shell=[...features,{id:'shell',type:'shell',label:'Shell',thickness:2,openingPlane:plane(40)}];
 assert.deepEqual(parseProject(serializeProject(shell)).features,shell);
 const hollow=rebuildModel(shell);assert.ok(hollow.mesh().triangles.length>0);assert.ok(Math.abs(require('replicad').measureVolume(hollow)-Math.PI*(400*40-324*38))<1e-3);hollow.delete();
 assert.throws(()=>rebuildModel([...features,{...shell[3],thickness:0}]));
});

const {test}=require('node:test');const assert=require('node:assert/strict');
const {editOperationSketch}=require('../src/lib/features/editOperationSketch.ts');
const {bindSketchDependencies,resolveSketchDependencies}=require('../src/lib/features/sketchDependencies.ts');
const {findProfileSources}=require('../src/lib/replicad/geometry.ts');
const {rebuildModel}=require('../src/lib/replicad/build-model.ts');
const {measureVolume}=require('replicad');
test('recovered cut slots can be selected separately or together and remain linked',async()=>{
 await require('./kernel.cjs')();
 const plane={origin:[0,0,0],normal:[0,0,1],xDir:[1,0,0]};
 const base=[{id:'rule',type:'sheetMetal',label:'Chapa',thickness:2},{id:'face',type:'face',label:'Face',plane,profile:{kind:'rect',x1:0,y1:0,x2:50,y2:50}}];
 const slots=[10,30].map(y=>({kind:'slot',c1:{x:10,y},c2:{x:20,y},r:2}));
 const cut={id:'cut',type:'face',label:'Recortar',plane,cut:true,profile:slots};
 let id=0;const recovered=editOperationSketch([...base,cut],'cut',()=>`id${++id}`);
 const sketch=recovered.sketch;
 const profiles=findProfileSources(sketch.shapes,sketch.points,sketch.shapes.map(s=>s.id));
 assert.equal(profiles.length,2);
 const volumes=[];
 for(const chosen of [[profiles[0]],profiles]) {
  const candidate={...cut,profile:chosen,sketchReference:undefined};
  const linked=bindSketchDependencies([sketch,candidate])[1];
  assert.equal(linked.sketchReference.profileShapeIds.length,chosen.length);
  const features=[...base,sketch,linked];
  assert.equal(resolveSketchDependencies(features).at(-1).profile.length,chosen.length);
  const solid=rebuildModel(features);try{volumes.push(measureVolume(solid));}finally{solid.delete();}
 }
 assert.ok(volumes[1]<volumes[0]);
});

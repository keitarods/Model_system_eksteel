const {test}=require('node:test');const assert=require('node:assert/strict');
const {rebuildModel,findFlangeParentId,attachFlangeReferences,editFlangeWithDependents}=require('../src/lib/replicad/build-model.ts');
const {pointOnFlange}=require('../src/lib/replicad/sheetMetal.ts');
const {serializeProject,parseProject}=require('../src/lib/project/nativeFormat.ts');
const r=require('replicad');
test('flange children follow length, angle and radius edits, recursively and after serialization',async()=>{
 await require('./kernel.cjs')();
 const base=[{id:'rule',type:'sheetMetal',thickness:2,label:'Regra'},{id:'base',type:'face',label:'Base',plane:{origin:[0,0,0],normal:[0,0,1],xDir:[1,0,0]},profile:{kind:'rect',x1:0,y1:0,x2:40,y2:30}},{id:'bend',type:'flange',label:'Dobra',parentId:'base',edgeStart:[0,0,2],edgeEnd:[40,0,2],length:12,angle:90,innerRadius:3,kFactor:.42}];
 assert.equal(findFlangeParentId(base.slice(0,2),[10,0,2],[30,0,2]),'base');
 assert.equal(findFlangeParentId(base.slice(0,2),[30,0,2],[10,0,2]),'base');
 assert.equal(findFlangeParentId(base.slice(0,2),[10,0.1,2],[30,0.1,2]),null);
 assert.equal(findFlangeParentId(base.slice(0,2),[-5,0,2],[20,0,2]),null);
 // A hidden imported source encloses the newly created native Face.
 const enclosing=r.makeBox([-10,-10,-10],[60,60,10]);
 const imported={id:'imported',type:'imported',label:'Source',format:'step',visible:false,brep:enclosing.serialize()};enclosing.delete();
 assert.equal(findFlangeParentId([imported,...base.slice(0,2)],[0,0,2],[40,0,2]),'base');
 // Also retain native ownership before fusion removes the Face's own edges.
 assert.equal(findFlangeParentId([{...imported,visible:true},...base.slice(0,2)],[0,0,2],[40,0,2]),'base');
 assert.equal(findFlangeParentId([imported,base[0],{...base[1],suppressed:true}],[0,0,2],[40,0,2]),null);
 const links=new Map();
 const build=features=>rebuildModel(features,{onFlange:(f,l)=>links.set(f.id,l)});
 build(base).delete();
 const child={id:'child',type:'flange',label:'Child',parentId:'bend',edgeStart:pointOnFlange(links.get('bend'),[0,1,0]),edgeEnd:pointOnFlange(links.get('bend'),[1,1,0]),length:8,angle:60};
 const parent=links.get('bend');
 assert.equal(findFlangeParentId(base,pointOnFlange(parent,[0.2,1,0]),pointOnFlange(parent,[0.8,1,0])),'bend');
 const legacy=[...base,child];build(legacy).delete();
 const grand={...child,id:'grand',parentId:'child',edgeStart:pointOnFlange(links.get('child'),[0,1,0]),edgeEnd:pointOnFlange(links.get('child'),[1,1,0]),length:6,angle:45};
 const original=[...legacy,grand];
 const attached=attachFlangeReferences(original);
 assert.equal(original[3].attachment,undefined);
 assert.throws(()=>editFlangeWithDependents([...base,{...child,suppressed:true}],{...base[2],length:22}),/Reative/);
 assert.ok(attached[3].attachment);assert.ok(attached[4].attachment);
 for(const change of [{length:22},{angle:55},{innerRadius:5},{length:18,angle:70,innerRadius:4}]){
  const edited=editFlangeWithDependents(original,{...base[2],...change});
  const actual=build(parseProject(serializeProject(edited)).features);
  const resolvedChild=links.get('child');const expectedStart=pointOnFlange(links.get('bend'),[0,1,0]);
  assert.ok(Math.hypot(...resolvedChild.axisPoint.map((v,i)=>v-expectedStart[i]))<1e-6);
  assert.ok(Math.hypot(...edited[3].edgeStart.map((v,i)=>v-expectedStart[i]))<1e-6);
  const expectedGrand=pointOnFlange(links.get('child'),[0,1,0]);
  assert.ok(Math.hypot(...links.get('grand').axisPoint.map((v,i)=>v-expectedGrand[i]))<1e-6);
  const manual=[...edited.slice(0,3),{...child,edgeStart:pointOnFlange(links.get('bend'),[0,1,0]),edgeEnd:pointOnFlange(links.get('bend'),[1,1,0])},{...grand,edgeStart:pointOnFlange(links.get('child'),[0,1,0]),edgeEnd:pointOnFlange(links.get('child'),[1,1,0])}];
  const expected=rebuildModel(manual);
  const delta=actual.cut(expected);try{assert.ok(Math.abs(r.measureVolume(delta))<1e-5);}finally{delta.delete();actual.delete();expected.delete();}
  const flat=rebuildModel(edited,{flatten:true});try{assert.ok(flat.mesh().triangles.length>0);}finally{flat.delete();}
 }
 const {useFeatureStore}=require('../src/lib/features/store.ts');const {undoModel,redoModel}=require('../src/lib/history/store.ts');
 useFeatureStore.setState({features:original});await Promise.resolve();
 const edited=editFlangeWithDependents(original,{...base[2],length:22});
 useFeatureStore.setState({features:edited});await Promise.resolve();
 undoModel();assert.equal(useFeatureStore.getState().features[2].length,12);
 redoModel();assert.equal(useFeatureStore.getState().features[2].length,22);assert.ok(useFeatureStore.getState().features[3].attachment);
});

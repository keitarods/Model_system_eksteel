const {test}=require('node:test');const assert=require('node:assert/strict');
const {operationEditingHistory}=require('../src/lib/features/historyTree.ts');
const plane={origin:[0,0,0],normal:[0,0,1],xDir:[1,0,0]};
const base={id:'base',type:'extrude',label:'Base',plane,profile:{kind:'rect',x1:0,y1:0,x2:20,y2:20},depth:10,cut:false};
const hole={id:'hole',type:'hole',label:'Furo posterior',plane,center:{x:10,y:10},radius:2,through:true,depth:10};
test('opening an operation immediately hides later geometry and cancel restores the original solid',async()=>{
 await require('./kernel.cjs')();const {rebuildModel}=require('../src/lib/replicad/build-model.ts');const {measureVolume}=require('replicad');
 const features=[base,hole];const snapshot=JSON.stringify(features);
 const editing=rebuildModel(operationEditingHistory(features,'base'));
 const changed=rebuildModel(operationEditingHistory(features,'base',{...base,depth:15}));
 const canceled=rebuildModel(operationEditingHistory(features,null));
 try{assert.ok(Math.abs(measureVolume(editing)-4000)<1e-6);assert.ok(Math.abs(measureVolume(changed)-6000)<1e-6);assert.ok(Math.abs(measureVolume(canceled)-(4000-40*Math.PI))<1e-5);}
 finally{editing.delete();changed.delete();canceled.delete();}
 assert.equal(JSON.stringify(features),snapshot);assert.equal(operationEditingHistory(features,null),features);
});
test('switching operations ignores pending previews of a different operation',()=>{
 const features=[base,hole];
 const prefix=operationEditingHistory(features,'base',{...hole,radius:7});assert.deepEqual(prefix,[base]);
 assert.deepEqual(operationEditingHistory(features,'hole',{...base,depth:20}),features);
 assert.equal(operationEditingHistory(features,'missing'),features);
});
test('non-profile and advanced editors also roll back, preserving body ownership and references',()=>{
 const fillet={id:'f',type:'fillet',label:'Arredondar',radius:2,edgePoints:[],bodyGroupId:'body'};
 const shell={id:'s',type:'shell',label:'Casca',thickness:1,openingPlane:plane,bodyGroupId:'body'};
 const features=[{...base,bodyGroupId:'body'},fillet,shell,hole];
 assert.deepEqual(operationEditingHistory(features,'f').map(f=>f.id),['base','f']);
 const edited=operationEditingHistory(features,'s',{id:'s',type:'shell',label:'Casca',thickness:2,openingPlane:plane});
 assert.deepEqual(edited.map(f=>f.id),['base','f','s']);assert.equal(edited[2].bodyGroupId,'body');assert.equal(edited[2].thickness,2);
});
test('flange value previews change geometry without committing the saved history',async()=>{
 await require('./kernel.cjs')();
 const {rebuildModel}=require('../src/lib/replicad/build-model.ts');
 const {measureVolume}=require('replicad');
 const rule={id:'rule',type:'sheetMetal',label:'Chapa',thickness:2};
 const face={id:'face',type:'face',label:'Face',plane,profile:{kind:'rect',x1:0,y1:0,x2:30,y2:40}};
 const flange={id:'bend',type:'flange',label:'Flange',parentId:'face',edgeStart:[30,40,2],edgeEnd:[0,40,2],length:12,angle:90};
 const features=[rule,face,flange];const snapshot=JSON.stringify(features);
 const volumes=[];
 for(const length of [12,20,30]) {
  const solid=rebuildModel(operationEditingHistory(features,'bend',{...flange,length}));
  try { volumes.push(measureVolume(solid));assert.ok(solid.mesh().triangles.length); }
  finally { solid.delete(); }
 }
 assert.ok(volumes[1]>volumes[0]);assert.ok(volumes[2]>volumes[1]);
 assert.equal(JSON.stringify(features),snapshot);
 const canceled=rebuildModel(operationEditingHistory(features,null));
 try { assert.ok(Math.abs(measureVolume(canceled)-volumes[0])<1e-6); }
 finally { canceled.delete(); }
});

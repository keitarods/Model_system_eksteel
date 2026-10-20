const {test}=require('node:test');const assert=require('node:assert/strict');
const {rebuildModel}=require('../src/lib/replicad/build-model.ts');
const {projectFlatBends}=require('../src/lib/replicad/drawingBends.ts');
const {autoDimensions}=require('../src/lib/drawing/autoDimensions.ts');
test('flat bend axes and panel dimensions follow parent chains and retain true lengths at scale',async()=>{
 await require('./kernel.cjs')();
 const features=[{id:'rule',type:'sheetMetal',label:'Rule',thickness:2},{id:'base',type:'face',label:'Base',plane:{origin:[0,0,0],normal:[0,0,1],xDir:[1,0,0]},profile:{kind:'rect',x1:0,y1:0,x2:60,y2:40}},{id:'bend',type:'flange',label:'Flange',parentId:'base',edgeStart:[0,0,2],edgeEnd:[60,0,2],length:30,angle:90}];
 const {pointOnFlange}=require('../src/lib/replicad/sheetMetal.ts');
 let parent;rebuildModel(features,{onFlange:(_,link)=>parent=link}).delete();
 features.push({id:'child',type:'flange',label:'Child',parentId:'bend',edgeStart:pointOnFlange(parent,[0,1,0]),edgeEnd:pointOnFlange(parent,[1,1,0]),length:18,angle:40});
 const bends=[];const shape=rebuildModel(features,{flatten:true,onFlange:(f,link,_p,chain)=>bends.push({id:f.id,label:f.label,link,chain})});shape.delete();
 const projections=['front','top','right'].map(o=>({o,b:projectFlatBends(bends,o)}));
 const full=projections.find(p=>p.b.length);assert.ok(full);
 assert.equal(projections.filter(p=>p.b.length).length,1);
 assert.deepEqual(projectFlatBends(bends,'iso'),[]);
 assert.equal(full.b.length,2);
 const child=full.b.find(b=>b.id==='child');assert.ok(Math.abs(Math.hypot(child.panel.x2-child.panel.x1,child.panel.y2-child.panel.y1)-(18+bends[1].link.allowance/2))<1e-6);
 for(const bend of full.b){
  assert.ok(Math.hypot(bend.panel.x1-bend.line.x1,bend.panel.y1-bend.line.y1)<1e-6,'flat length starts on the exact bend line');
 }
 for(const bend of bends){
  const profiles=['front','top','right'].flatMap(o=>projectFlatBends(bends,o,false)).filter(b=>b.id===bend.id&&b.measurePanel);
  assert.ok(profiles.length,'each flange has a true-length projection');
  for(const p of profiles) assert.ok(Math.abs(Math.hypot(p.panel.x2-p.panel.x1,p.panel.y2-p.panel.y1)-bend.link.length)<1e-6);
 }
 // Edge-on native dimensions must cover the full panel, never silhouette fragments.
 const {bendAngles}=require('../src/lib/drawing/angularDimensions.ts');
 for(const orientation of ['front','top','right']){
  const panelDimensions=projectFlatBends(bends,orientation,false);
  const view={id:'profile',orientation,flattened:false,x:100,y:100,scale:1,
    box:{minX:-100,minY:-100,width:200,height:200},lineEdges:[{x1:0,y1:0,x2:7,y2:0}],panelDimensions};
  const dims=autoDimensions(view);
  if(panelDimensions.length) assert.ok(!dims.some(d=>d.value===7),'no partial silhouette dimensions');
  for(const d of dims.filter(d=>d.bendId)){
   if(d.bendId==='bend') assert.equal(d.suffix,undefined,'shared web carries no single bend angle');
  }
  assert.equal(bendAngles(view,[90,40]).length,0);
 }
 const b=full.b[0];assert.ok(Math.abs(Math.hypot(b.line.x2-b.line.x1,b.line.y2-b.line.y1)-60)<1e-6);
 for(const scale of [.25,1,2]){
  const view={id:'v',orientation:full.o,flattened:true,x:100,y:100,scale,box:{minX:-100,minY:-100,width:200,height:200},lineEdges:[],flatBends:full.b};
  const dims=autoDimensions(view).filter(d=>d.bendId==='bend');
  assert.equal(dims.length,2);assert.equal(dims[0].suffix,' (90°)');assert.equal(dims[1].suffix,undefined);
  const childDims=autoDimensions(view).filter(d=>d.bendId==='child');assert.equal(childDims[0].suffix,' (40°)');assert.equal(childDims.length,1);
  assert.ok(autoDimensions(view).every(d=>!/(largura|aba)/.test(d.suffix??'')));assert.ok(Math.abs(dims[0].value-(30+bends[0].link.allowance/2))<1e-6);assert.ok(Math.abs(dims[1].value-60)<1e-6);
  assert.ok(Math.abs(Math.hypot(dims[0].x2-dims[0].x1,dims[0].y2-dims[0].y1)-(30+bends[0].link.allowance/2)*scale)<1e-6);
  assert.equal(autoDimensions(view,false).filter(d=>d.bendId).length,0);
 }
});

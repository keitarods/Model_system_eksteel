const {test}=require('node:test');const assert=require('node:assert/strict');
const {rebuildModel}=require('../src/lib/replicad/build-model.ts');
const {serializeProject,parseProject}=require('../src/lib/project/nativeFormat.ts');
const {measureVolume}=require('replicad');
const plane={origin:[0,0,0],normal:[0,0,1],xDir:[1,0,0]};
test('extrude and sheet cuts pass through a growing body even from a distant sketch plane',async()=>{
 await require('./kernel.cjs')();
 for(const type of ['extrude','face']) for(const depth of [10,80]) {
  const base={id:'base',type:'extrude',label:'Base',plane,profile:{kind:'rect',x1:0,y1:0,x2:20,y2:20},depth,cut:false};
  const cut={id:'cut',type,label:'Passante',plane:{...plane,origin:[0,0,200]},profile:{kind:'rect',x1:5,y1:5,x2:15,y2:15},depth:1,cutDepth:1,cut:true,through:true,direction:"flipped"};
  const features=[{id:'rule',type:'sheetMetal',label:'Chapa',thickness:2},base,cut];
  const saved=parseProject(serializeProject(features)).features;
  assert.equal(saved.at(-1).through,true);
  const solid=rebuildModel(saved);
  try{assert.ok(Math.abs(measureVolume(solid)-300*depth)<1e-5);assert.ok(solid.mesh().triangles.length);}finally{solid.delete();}
 }
});

test('through cuts remove only the selected side of the sketch plane',async()=>{
 await require('./kernel.cjs')();
 for(const type of ['extrude','face']) for(const direction of ['normal','flipped','symmetric']) {
  const base={id:'base',type:'extrude',label:'Base',plane,profile:{kind:'rect',x1:0,y1:0,x2:20,y2:20},depth:30,cut:false};
  const cut={id:'cut',type,label:'Passante',plane:{...plane,origin:[0,0,10]},profile:{kind:'rect',x1:5,y1:5,x2:15,y2:15},depth:1,cutDepth:1,cut:true,through:true,direction};
  const solid=rebuildModel([{id:'rule',type:'sheetMetal',label:'Chapa',thickness:2},base,cut]);
  try {
   const removed = direction==='normal' ? 2000 : direction==='flipped' ? 1000 : 3000;
   assert.ok(Math.abs(measureVolume(solid)-(12000-removed))<1e-5, `${type} ${direction}`);
  } finally {solid.delete();}
 }
});

const {test}=require('node:test');const assert=require('node:assert/strict');
const {rebuildModel}=require('../src/lib/replicad/build-model.ts');
const {serializeProject,parseProject}=require('../src/lib/project/nativeFormat.ts');
test('sheet cuts use rule thickness by default or explicit distance, including native round trip',async()=>{
 await require('./kernel.cjs')();const r=require('replicad');
 const plane={origin:[0,0,0],normal:[0,0,1],xDir:[1,0,0]};
 const rule={id:'rule',type:'sheetMetal',label:'Rule',thickness:4};
 const base={id:'base',type:'face',label:'Base',plane,profile:{kind:'rect',x1:0,y1:0,x2:10,y2:10}};
 const cut={...base,id:'cut',cut:true,profile:{kind:'rect',x1:2,y1:2,x2:4,y2:4}};
 const volume=features=>{const solid=rebuildModel(parseProject(serializeProject(features)).features);try{return r.measureVolume(solid);}finally{solid.delete();}};
 assert.ok(Math.abs(volume([rule,base,cut])-384)<1e-6);
 assert.ok(Math.abs(volume([rule,base,{...cut,cutDepth:1}])-396)<1e-6);
 assert.ok(Math.abs(volume([{...rule,thickness:6},base,cut])-576)<1e-6);
 assert.ok(Math.abs(volume([{...rule,thickness:6},base,{...cut,cutDepth:1}])-596)<1e-6);
 assert.ok(Math.abs(volume([rule,{...base,cutDepth:1}])-400)<1e-6);
 assert.throws(()=>rebuildModel([rule,base,{...cut,cutDepth:0}]),/distância positiva/);
});

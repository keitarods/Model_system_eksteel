const {test}=require('node:test');const assert=require('node:assert/strict');
const {rebuildModel}=require('../src/lib/replicad/build-model.ts');
const {buildDrawingView}=require('../src/lib/replicad/technicalDrawing.ts');
const {autoDimensions}=require('../src/lib/drawing/autoDimensions.ts');
const {bendAngles}=require('../src/lib/drawing/angularDimensions.ts');
test('native bend frames identify only the actual bend in an orthogonal profile',async()=>{
 await require('./kernel.cjs')();
 for(const angle of [40,90]) {
 const bends=[];
 const solid=rebuildModel([{id:'rule',type:'sheetMetal',thickness:2,label:'Rule'},{id:'base',type:'face',label:'Base',plane:{origin:[0,0,0],normal:[0,0,1],xDir:[1,0,0]},profile:{kind:'rect',x1:0,y1:0,x2:60,y2:50}},{id:'bend',type:'flange',label:'Bend',parentId:'base',edgeStart:[0,0,2],edgeEnd:[60,0,2],length:30,angle,innerRadius:3}],{onFlange:(f,link)=>bends.push({id:f.id,label:f.label,link})});
 try{
  const views=['front','top','right'].map(o=>buildDrawingView(solid,o,false,{bends}));
  const panels=views.flatMap(v=>autoDimensions({...v,x:100,y:100,scale:1})).filter(d=>d.bendId==='bend'&&d.suffix);
  assert.ok(panels.some(d=>Math.abs(d.value-30)<1e-6&&d.suffix===` (${angle}°)`));
  assert.equal(views.flatMap(v=>bendAngles(v,[angle])).length,0);
  const dims=views.flatMap(v=>bendAngles({...v,panelDimensions:[]},[angle]));
  assert.ok(dims.length>0,`no native angle for ${angle}`);
  assert.ok(dims.every(d=>d.bendId==='bend'&&Math.abs(d.value-(180-angle))<0.01));
 }finally{solid.delete();}
 }
});

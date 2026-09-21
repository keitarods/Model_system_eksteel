const {test}=require('node:test');const assert=require('node:assert/strict');
const {rebuildModel}=require('../src/lib/replicad/build-model.ts');
const {recognizeBentSheet}=require('../src/lib/replicad/recognizeOperations.ts');
const features=[{id:'rule',type:'sheetMetal',thickness:2,label:'Regra'},{id:'base',type:'face',label:'Base',plane:{origin:[0,0,0],normal:[0,0,1],xDir:[1,0,0]},profile:{kind:'rect',x1:0,y1:0,x2:40,y2:30}},{id:'bend',type:'flange',label:'Dobra',parentId:'base',edgeStart:[0,0,2],edgeEnd:[40,0,2],length:12,angle:90,innerRadius:3,kFactor:.42}];
test('recognizes cylindrical bend from geometry and requires explicit manufacturing K',async()=>{
 await require('./kernel.cjs')();const body=rebuildModel(features);
 try {
  const source={id:'step',type:'imported',format:'step',label:'STEP',brep:body.serialize()};const original=source.brep;let n=0;
  assert.throws(()=>recognizeBentSheet(source,NaN,()=>String(++n)),/fator K/);
  const result=recognizeBentSheet(source,.42,()=>String(++n));
  assert.ok(result.differenceVolume<=result.toleranceVolume);
  const bend=result.features.find(f=>f.type==='flange');assert.equal(bend.kFactor,.42);assert.ok(Math.abs(bend.innerRadius-3)<1e-6);
  assert.equal(source.brep,original);
  const flat=rebuildModel(result.features,{flatten:true});try{assert.ok(flat.mesh().triangles.length);}finally{flat.delete();}
 }finally{body.delete();}
});
test('rejects unsupported solid without changing its BREP',async()=>{
 await require('./kernel.cjs')();const r=require('replicad'),body=r.makeBox([0,0,0],[20,30,10]);
 try{const source={id:'s',type:'imported',format:'step',label:'Box',brep:body.serialize()};const original=source.brep;
 assert.throws(()=>recognizeBentSheet(source,.4,()=>Math.random().toString()),/dobra cilíndrica/);assert.equal(source.brep,original);
 }finally{body.delete();}
});
test('recognizes oblique bend after rigid rotation and translation',async()=>{
 await require('./kernel.cjs')();const body=rebuildModel([...features.slice(0,-1),{...features.at(-1),angle:45}]);
 const moved=body.rotate(33,[0,0,0],[1,1,0]).translate([70,-20,15]);
 try{let n=0;const result=recognizeBentSheet({id:'s',type:'imported',format:'step',label:'Rotated',brep:moved.serialize()},.4,()=>`r${++n}`);
 assert.ok(result.differenceVolume<=result.toleranceVolume);assert.ok(Math.abs(Math.abs(result.features.find(f=>f.type==='flange').angle)-45)<1e-5);
 }finally{moved.delete();}
});

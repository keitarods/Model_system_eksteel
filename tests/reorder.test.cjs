const {test}=require('node:test');const assert=require('node:assert/strict');
const {moveOperation}=require('../src/lib/features/reorder.ts');
const plane={origin:[0,0,0],normal:[0,0,1],xDir:[1,0,0]};
const a={id:'a',type:'extrude',label:'A',plane,profile:{kind:'rect',x1:0,y1:0,x2:20,y2:20},depth:10,cut:false};
const b={...a,id:'b',label:'B',profile:{kind:'rect',x1:10,y1:0,x2:30,y2:20},depth:20};
test('independent operations move in both directions and rebuild',async()=>{
 await require('./kernel.cjs')();const {rebuildModel}=require('../src/lib/replicad/build-model.ts');
 const original=[a,b];const reordered=moveOperation(original,'b',-1);
 assert.deepEqual(reordered.map(f=>f.id),['b','a']);assert.deepEqual(original,[a,b]);
 assert.deepEqual(moveOperation(reordered,'b',1),original);
 const solid=rebuildModel(reordered);try{assert.ok(solid.mesh().triangles.length);}finally{solid.delete();}
 assert.equal(moveOperation(original,'a',-1),original);
});
test('owned sketches travel with their operation; shared dependencies cannot be crossed',()=>{
 const sketch={id:'sk',type:'sketch',label:'Sketch',plane,shapes:[],points:{},dimensions:[]};
 const linked={...b,sketchReference:{sketchId:'sk',profileShapeIds:[]}};
 assert.deepEqual(moveOperation([a,sketch,linked],'b',-1).map(f=>f.id),['sk','b','a']);
 assert.deepEqual(moveOperation([sketch,{...a,sketchReference:linked.sketchReference},linked],'a',1).map(f=>f.id),['sk','b','a']);
 const pattern={id:'p',type:'pattern',label:'Padrão',kind:'rectangular',sourceFeatureId:'a'};
 assert.throws(()=>moveOperation([a,pattern],'p',-1),/origem/);
});
test('sheet operations cannot cross their rule or flange parent',()=>{
 const rule={id:'r',type:'sheetMetal',label:'Regra',thickness:2};
 const face={...a,type:'face'};
 assert.throws(()=>moveOperation([rule,face],'a',-1),/regra de chapa/);
 const bend={id:'fl',type:'flange',label:'Flange',parentId:'a'};
 assert.throws(()=>moveOperation([rule,face,bend],'fl',-1),/origem/);
});
test('drag placement moves directly across multiple rows, in either direction',()=>{
 const {moveOperationTo}=require('../src/lib/features/reorder.ts');
 const c={...b,id:'c'},d={...b,id:'d'};
 const original=[a,b,c,d];
 const moved=moveOperationTo(original,'d','a','before');
 assert.deepEqual(moved.map(f=>f.id),['d','a','b','c']);
 assert.deepEqual(moveOperationTo(moved,'d','c','after'),original);
 assert.equal(moveOperationTo(original,'a','a','before'),original);
 assert.equal(moveOperationTo(original,'b','a','after'),original);
 const pattern={id:'p',type:'pattern',label:'Padrão',kind:'rectangular',sourceFeatureId:'a'};
 assert.throws(()=>moveOperationTo([a,b,c,pattern],'p','a','before'),/origem/);
 assert.deepEqual(original.map(f=>f.id),['a','b','c','d']);
});

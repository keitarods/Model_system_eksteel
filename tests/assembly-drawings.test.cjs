const {test}=require('node:test');
const assert=require('node:assert/strict');
const {generateAutomaticSheets}=require('../src/lib/drawing/automaticSheets.ts');
const {createEmptyPartProperties}=require('../src/lib/project/partProperties.ts');
const {serializeDrawing,parseDrawing}=require('../src/lib/drawing/documentFormat.ts');
const {computeBomRows}=require('../src/lib/drawing/bom.ts');
const {rebuildModel}=require('../src/lib/replicad/build-model.ts');
const properties={...createEmptyPartProperties(),partNumber:'CH-01',description:'Suporte',material:'Aço'};
const instance=id=>({id,linkKey:'same-file',label:id,suppressed:false,assemblyFeatures:[]});

test('assembly creates grouped BOM and editable bent/flat component sheets with native dimensions',async()=>{
 await require('./kernel.cjs')();
 const features=[{id:'rule',type:'sheetMetal',thickness:2,label:'Rule'},{id:'base',type:'face',label:'Base',plane:{origin:[0,0,0],normal:[0,0,1],xDir:[1,0,0]},profile:{kind:'rect',x1:0,y1:0,x2:60,y2:50}},{id:'bend',type:'flange',label:'Bend',parentId:'base',edgeStart:[0,0,2],edgeEnd:[60,0,2],length:30,angle:90,innerRadius:3}];
 const part={kind:'peca',signature:JSON.stringify(features),supportsFlatten:true,bends:[{id:'bend',label:'Dobra',length:30,angle:90,innerRadius:3}],emptyMessage:'missing',buildShape:({flatten,onBend})=>rebuildModel(features,{flatten,onFlange:(f,link)=>onBend?.({id:f.id,label:f.label,link})})};
 const components=['a','b'].map(id=>({id,name:'CH-01',group:'same',available:true,properties,source:part}));
 const source={kind:'montagem',signature:'assembly',supportsFlatten:false,emptyMessage:'missing',buildShape:()=>part.buildShape({flatten:false}),componentSources:()=>components,bomParts:()=>['a','b'].map(id=>({instance:instance(id),properties,solid:null}))};
 const sheets=await generateAutomaticSheets(source,true);
 assert.equal(sheets.length,3);
 assert.equal(sheets[0].bomTables[0].rows.length,1);
 assert.equal(sheets[0].bomTables[0].rows[0].values.quantity,'2');
 assert.ok(sheets[0].views.some(v=>v.orientation==='iso'));
 assert.equal(sheets[1].sourceInstanceId,'a');
 assert.equal(sheets[2].sourceInstanceId,'a');
 assert.ok(sheets[1].views.every(v=>v.flattened));
 assert.ok(sheets[2].views.every(v=>!v.flattened));
 assert.ok(sheets[2].views.some(v=>v.orientation==='iso'));
 assert.ok(sheets[2].dimensions.some(d=>d.bendId==='bend'));
 assert.ok(sheets[1].dimensions.length>0);
 assert.equal(sheets[2].titleBlock.code,'CH-01');
 assert.deepEqual(sheets.map(s=>s.titleBlock.page),['1/3','2/3','3/3']);
 assert.deepEqual(parseDrawing(serializeDrawing(sheets)),JSON.parse(JSON.stringify(sheets)));
});

test('unresolved parts block generation without partial assembly sheets',async()=>{
 let built=false;
 const source={componentSources:()=>[{name:'Peça perdida',available:false}],buildShape:()=>{built=true;}};
 await assert.rejects(generateAutomaticSheets(source,true),/Peça perdida/);
 assert.equal(built,false);
});

test('BOM distinguishes local machining variants and excludes suppressed instances',()=>{
 const rows=computeBomRows([
  {instance:instance('a'),properties,solid:null,geometrySignature:'original'},
  {instance:instance('b'),properties,solid:null,geometrySignature:'original'},
  {instance:instance('c'),properties,solid:null,geometrySignature:'cut'},
  {instance:{...instance('d'),suppressed:true},properties,solid:null,geometrySignature:'original'},
 ]);
 assert.deepEqual(rows.map(r=>r.values.quantity),['2','1']);
});

test('large assembly BOM continues on another sheet without dropping items',async()=>{
 await require('./kernel.cjs')();
 const {drawRectangle}=require('replicad');
 const part={kind:'peca',signature:'box',supportsFlatten:false,emptyMessage:'missing',buildShape:()=>drawRectangle(10,10).sketchOnPlane('XY').extrude(5)};
 const parts=Array.from({length:26},(_,i)=>({instance:{...instance(String(i)),linkKey:`file-${i}`},properties:{...properties,partNumber:`P-${i}`},solid:null}));
 const components=parts.map(p=>({id:p.instance.id,name:p.properties.partNumber,group:p.instance.linkKey,available:true,properties:p.properties,source:part}));
 const sheets=await generateAutomaticSheets({...part,kind:'montagem',componentSources:()=>components,bomParts:()=>parts},false);
 const tables=sheets.flatMap(s=>s.bomTables??[]);
 assert.deepEqual(tables.map(t=>t.rows.length),[25,1]);
 assert.equal(tables[1].rows[0].values.item,'26');
 assert.deepEqual(tables[1].rowRange,{start:25,count:25});
 assert.equal(sheets.filter(s=>s.sourceInstanceId!==undefined).length,26);
 assert.equal(sheets.at(-1).titleBlock.page,'28/28');
});

const {test}=require('node:test');const assert=require('node:assert/strict');
const {autoDimensions,autoCircleNotes}=require('../src/lib/drawing/autoDimensions.ts');
const {buildDrawingView}=require('../src/lib/replicad/technicalDrawing.ts');
const {serializeDrawing,parseDrawing}=require('../src/lib/drawing/documentFormat.ts');
const {createSheetObject}=require('../src/lib/drawing/store.ts');
test('automatic dimensions keep model measurements across sheet scales and serialization',async()=>{
 await require('./kernel.cjs')();const r=require('replicad');const solid=r.makeBox([0,0,0],[100,60,4]);
 try {
  const view=buildDrawingView(solid,'top',true,{x:100,y:100,scale:0.5});
  const dims=autoDimensions(view,false);
  assert.deepEqual(dims.map(d=>Math.round(d.value)).sort((a,b)=>a-b),[60,100]);
  for(const d of dims) assert.ok(Math.abs(Math.hypot(d.x2-d.x1,d.y2-d.y1)*2-d.value)<1e-6);
  assert.equal(autoDimensions({...view,orientation:'iso'}).length,0);
  const sheet=createSheetObject('Planificada');sheet.views=[view];sheet.dimensions=dims;
  assert.deepEqual(parseDrawing(serializeDrawing([sheet]))[0].dimensions,dims);
  const cylinder=r.makeCylinder(5,10);
  try{const v=buildDrawingView(cylinder,'top',false);assert.equal(v.circles.length,1);assert.ok(Math.abs(v.circles[0].radius-5)<1e-6);assert.match(autoCircleNotes(v)[0].text,/10/);}finally{cylinder.delete();}
 }finally{solid.delete();}
});
test('partial chains deduplicate vertices and omit crowded segments',()=>{
 const view={id:'v',orientation:'front',x:100,y:100,scale:1,box:{minX:0,minY:0,width:100,height:50},lineEdges:[{x1:0,y1:0,x2:30,y2:0},{x1:30,y1:0,x2:100,y2:0}]};
 assert.deepEqual(autoDimensions(view).map(d=>d.value).sort((a,b)=>a-b),[30,50,70,100]);
 assert.equal(autoDimensions({...view,scale:0.01}).length,2);
});
test('automatic measurements follow view placement and are invalidated by new geometry',()=>{
 const {useDrawingStore}=require('../src/lib/drawing/store.ts');
 const sheet=createSheetObject('Teste');
 const view={id:'v',orientation:'front',x:100,y:100,scale:1,box:{minX:0,minY:0,width:100,height:50},lineEdges:[]};
 sheet.views=[view];sheet.dimensions=autoDimensions(view,false);
 useDrawingStore.getState().loadSheets([sheet]);
 useDrawingStore.getState().updateView(sheet.id,'v',{x:120,scale:0.5});
 const dim=useDrawingStore.getState().sheets[0].dimensions[0];
 assert.equal(dim.value,100);assert.equal(dim.x1,95);assert.equal(dim.x2,145);
 useDrawingStore.getState().updateView(sheet.id,'v',{lineEdges:[]});
 assert.equal(useDrawingStore.getState().sheets[0].dimensions.length,0);
});
test('CAD rounded stock exports actual arcs and nominal full side sizes',async()=>{
 await require('./kernel.cjs')();const r=require('replicad');
 const solid=r.drawRoundedRectangle(100,50,10).sketchOnPlane('XY').extrude(2);
 try {
  const view=buildDrawingView(solid,'top',true);
  assert.equal(view.arcs.length,4);
  assert.ok(view.arcs.every(a=>Math.abs(a.radius-10)<1e-5));
  const dims=autoDimensions(view);
  assert.ok(dims.some(d=>Math.abs(d.value-100)<1e-5));
  assert.ok(dims.some(d=>Math.abs(d.value-50)<1e-5));
  assert.ok(!dims.some(d=>Math.abs(d.value-80)<1e-5));
 }finally{solid.delete();}
});

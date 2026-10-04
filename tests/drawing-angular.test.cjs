const {test}=require('node:test');const assert=require('node:assert/strict');
const {bendAngles,dimensionText}=require('../src/lib/drawing/angularDimensions.ts');
const {serializeDrawing,parseDrawing}=require('../src/lib/drawing/documentFormat.ts');
const {createSheetObject}=require('../src/lib/drawing/store.ts');
const view={bendProfiles:[{id:'bend1',label:'Aba 1',x:90,y:10,radius:10,outerRadius:12,angle:90}],id:'v',orientation:'front',flattened:false,x:100,y:100,scale:0.5,box:{minX:0,minY:0,width:100,height:50},visibleLineEdges:[{x1:0,y1:0,x2:90,y2:0},{x1:100,y1:10,x2:100,y2:50}],arcs:[{x:90,y:10,radius:10,start:{x:90,y:0},mid:{x:97.071,y:2.929},end:{x:100,y:10}}]};
test('bend angle uses real circular profile and remains independent of sheet scale',()=>{
 const dims=bendAngles(view,[90]);assert.equal(dims.length,1);assert.ok(Math.abs(dims[0].value-90)<1e-9);
 assert.equal(bendAngles({...view,flattened:true},[90]).length,0);
 assert.equal(bendAngles(view,[45]).length,0);
 assert.equal(bendAngles({...view,orientation:'iso'},[90]).length,0);
 const sheet=createSheetObject('Dobrada');sheet.dimensions=[{...dims[0],precision:1,tolerancePrecision:1,prefix:'',suffix:'',toleranceUpper:0.5,toleranceLower:0.2}];
 assert.deepEqual(parseDrawing(serializeDrawing([sheet]))[0].dimensions,sheet.dimensions);
 assert.equal(dimensionText(sheet.dimensions[0]),'90,0° +0,5/−0,2');
 sheet.dimensions[0].precision=99;assert.throws(()=>serializeDrawing([sheet]),/Precisão/);
});
test('40 degree bend rotation produces a 140 degree opening, not a 40 degree label',()=>{
 const angle=40*Math.PI/180,r=10,p={x:r*Math.cos(angle),y:r*Math.sin(angle)};
 const candidate={...view,bendProfiles:[{id:'bend1',label:'Aba 1',x:0,y:0,radius:10,outerRadius:12,angle:40}],visibleLineEdges:[{x1:10,y1:-20,x2:10,y2:0},{x1:p.x,y1:p.y,x2:p.x-20*Math.sin(angle),y2:p.y+20*Math.cos(angle)}],arcs:[{x:0,y:0,radius:r,start:{x:10,y:0},mid:{x:r*Math.cos(angle/2),y:r*Math.sin(angle/2)},end:p}]};
 const dims=bendAngles(candidate,[40]);assert.equal(dims.length,1);assert.ok(Math.abs(dims[0].value-140)<1e-8);
});
test('manual angular dimension supports separated straight sides and rejects parallel lines',()=>{
 const {angleBetweenLines}=require('../src/lib/drawing/angularDimensions.ts');
 const dim=angleBetweenLines('v',{x1:0,y1:0,x2:50,y2:0},{x1:60,y1:10,x2:60,y2:50});
 assert.ok(Math.abs(dim.value-90)<1e-9);assert.equal(dim.x1,60);assert.equal(dim.y1,0);
 assert.equal(dim.automatic,undefined);
 assert.equal(angleBetweenLines('v',{x1:0,y1:0,x2:50,y2:0},{x1:0,y1:10,x2:50,y2:10}),null);
});

test('same-angle fillets are not bends and distinct equal-angle bends are retained',()=>{
 assert.equal(bendAngles({...view,bendProfiles:[]},[90]).length,0);
 assert.equal(bendAngles({...view,bendProfiles:[{...view.bendProfiles[0],x:190}]},[90]).length,0);
 const shiftedArc={...view.arcs[0],x:290,start:{x:290,y:0},mid:{x:297.071,y:2.929},end:{x:300,y:10}};
 const second={...view,bendProfiles:[...view.bendProfiles,{...view.bendProfiles[0],id:'bend2',x:290}],arcs:[...view.arcs,shiftedArc],visibleLineEdges:[...view.visibleLineEdges,...view.visibleLineEdges.map(e=>({...e,x1:e.x1+200,x2:e.x2+200}))]};
 assert.deepEqual(bendAngles(second,[90]).map(d=>d.bendId),['bend1','bend2']);
});

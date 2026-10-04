const {test}=require('node:test');const assert=require('node:assert/strict');
const {isoFit}=require('../src/lib/drawing/isoFits.ts');
const {dimensionText}=require('../src/lib/drawing/angularDimensions.ts');
const {layoutLeaders,leaderDragPatch}=require('../src/lib/drawing/leaderLayout.ts');
const {createSheetObject,useDrawingStore}=require('../src/lib/drawing/store.ts');
const {serializeDrawing,parseDrawing}=require('../src/lib/drawing/documentFormat.ts');
test('ISO 286 band limits, units, symmetric deviations and unsupported classes',()=>{
 assert.equal(isoFit(30,'H7').upper,0.021);assert.equal(isoFit(30.001,'H7').upper,0.025);
 assert.equal(isoFit(50,'h7').lower,-0.025);assert.equal(isoFit(50,'H1').upper,0.0015);
 assert.equal(isoFit(50,'H2').upper,0.0025);assert.equal(isoFit(50,'js15').lower,-0.5);
 assert.equal(isoFit(50,'js4').upper,0.0035);
 for(const code of ['j7','H19','h0','H7x'])assert.throws(()=>isoFit(50,code));
 assert.throws(()=>isoFit(501,'H7'));assert.throws(()=>isoFit(0,'H7'));
});
test('fit persistence rejects altered limits and formatting never rounds away tiny ISO tolerances',()=>{
 const sheet=createSheetObject('Teste');const fit=isoFit(50,'JS1');
 const d={id:'d',viewId:'v',x1:0,y1:0,x2:50,y2:0,offset:8,value:50,fitClass:'JS1',toleranceUpper:fit.upper,toleranceLower:-fit.lower,tolerancePrecision:2};
 sheet.dimensions=[d];assert.deepEqual(parseDrawing(serializeDrawing([sheet]))[0].dimensions,[d]);
 assert.match(dimensionText(d),/0,00075/);
 d.toleranceUpper=1;assert.throws(()=>serializeDrawing([sheet]),/Desvios/);
});
test('leader placement separates labels and anchored drag leaves reference fixed',()=>{
 const sheet=createSheetObject('Teste');sheet.annotations=[0,1,2].map(i=>({id:String(i),viewId:'v',kind:'leader',x1:50,y1:50,x2:60,y2:60,text:'R10'}));
 const result=layoutLeaders(sheet).annotations;
 assert.equal(new Set(result.map(a=>a.x2+','+a.y2)).size,3);
 assert.ok(result.every(a=>a.x1===50&&a.y1===50));
 assert.deepEqual(leaderDragPatch(result[0],10,20),{x1:50,y1:50,x2:result[0].x2+10,y2:result[0].y2+20});
 sheet.views=[{id:'v',x:50,y:50,scale:1}];useDrawingStore.getState().loadSheets([sheet]);
 useDrawingStore.getState().moveView(sheet.id,'v',70,80);
 const moved=useDrawingStore.getState().sheets[0].annotations[0];
 assert.equal(moved.x1,70);assert.equal(moved.y1,80);assert.equal(moved.x2,60);
});

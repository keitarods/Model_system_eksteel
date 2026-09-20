const {test}=require('node:test');const assert=require('node:assert/strict');
const {cubicSplineEdit,mirrorShapes}=require('../src/lib/sketch/modify.ts');
const {cubicPoint,resolveSpline,nearestSplinePoint,sampleSpline}=require('../src/lib/sketch/spline.ts');
const {findEdgeHit}=require('../src/lib/sketch/hitTest.ts');
const {useSketchStore:s}=require('../src/lib/sketch/store.ts');
const {undoModel,redoModel,useUndoStore:h}=require('../src/lib/history/store.ts');
const {findProfileSource,findProfileSources,profileToDrawing,extrudeProfile,pathToDrawing}=require('../src/lib/replicad/geometry.ts');
const {buildDxf}=require('../src/lib/project/dxf.ts');const {parseDxf}=require('../src/lib/project/dxfImport.ts');
const {serializeProject,parseProject}=require('../src/lib/project/nativeFormat.ts');
const controls=[{x:0,y:0},{x:0,y:100},{x:100,y:100},{x:100,y:0}];
const tick=()=>new Promise(r=>queueMicrotask(r));
test('cubic evaluation, snap and curve selection use the actual curve rather than the chord',()=>{
 const edit=cubicSplineEdit(controls),shape=edit.shapes[0];
 assert.deepEqual(cubicPoint(controls,.5),{x:50,y:75});
 const nearest=nearestSplinePoint({x:50,y:80},controls);assert.ok(Math.hypot(nearest.x-50,nearest.y-75)<1e-5);
 assert.equal(findEdgeHit({x:50,y:75},edit.shapes,edit.points,2).kind,'spline');
 assert.equal(findEdgeHit({x:50,y:0},edit.shapes,edit.points,2),null);
 const sampled=sampleSpline(controls);assert.deepEqual(sampled[0],controls[0]);assert.deepEqual(sampled.at(-1),controls[3]);assert.ok(sampled.length>8&&sampled.length<=4097);
 assert.deepEqual(resolveSpline(shape,edit.points),controls.map((p,i)=>({...p,id:[shape.p1,shape.control1,shape.control2,shape.p2][i]})));
});
test('four-click spline preview, cancel, undo/redo, control edit and mirror preserve native geometry',async()=>{
 s.getState().clear();s.getState().setTool('spline');await tick();h.setState({past:[],future:[]});
 controls.slice(0,3).forEach(p=>s.getState().handleRawDown(p));s.getState().handleRawMove(controls[3]);await tick();
 assert.ok(s.getState().modifyPreview);assert.equal(h.getState().past.length,0);
 s.getState().handleRawDown(controls[3]);await tick();assert.equal(s.getState().shapes.length,1);
 const state=s.getState(),shape=state.shapes[0];assert.equal(shape.type,'spline');
 const feature={id:'sk',type:'sketch',label:'spline',plane:state.activePlane,shapes:state.shapes,points:state.points,dimensions:[]};
 assert.deepEqual(parseProject(serializeProject([feature])).features,[feature]);
 undoModel();assert.equal(s.getState().shapes.length,0);redoModel();assert.equal(s.getState().shapes[0].type,'spline');
 s.getState().movePoints({[shape.control1]:{x:-20,y:100}});assert.equal(s.getState().points[shape.control1].x,-20);
 const reflected=mirrorShapes(state.shapes,state.points,{x:0,y:0},{x:1,y:0});assert.equal(reflected.points[reflected.shapes[0].control1].y,-100);
 s.getState().setTool('spline');s.getState().handleRawDown({x:200,y:200});s.getState().setTool('select');assert.equal(s.getState().arcPoints.length,0);
});
test('DXF exports a cubic SPLINE and imports all four controls and rejects unsupported rational knots',()=>{
 const edit=cubicSplineEdit(controls);const text=buildDxf(edit.shapes,edit.points);assert.match(text,/AC1015/);assert.match(text,/AcDbSpline/);
 const imported=parseDxf(text);assert.equal(imported.shapes[0].type,'spline');
 const values=resolveSpline(imported.shapes[0],imported.points).map(({x,y})=>({x,y}));assert.deepEqual(values,controls);
 assert.throws(()=>parseDxf(text.replace('71\n3','71\n2')),/SPLINE/);
});
test('closed spline and line extrude with analytic volume in both traversal directions',async()=>{
 await require('./kernel.cjs')();const edit=cubicSplineEdit(controls),curve=edit.shapes[0];
 const line={id:'close',type:'line',p1:curve.p2,p2:curve.p1};
 for(const shapes of [[curve,line],[line,curve]]){
  const profile=findProfileSource(shapes,edit.points);assert.equal(profile.kind,'loop');assert.ok(profile.splineControls.some(Boolean));
  assert.equal(findProfileSources(shapes,edit.points,[curve.id]).length,1);
  const solid=extrudeProfile(profileToDrawing(profile),10,{origin:[0,0,0],normal:[0,0,1],xDir:[1,0,0]});
  // Integral y dx for x=100(3t²-2t³), y=300t(1-t) is 6000 mm².
  assert.ok(Math.abs(require('replicad').measureVolume(solid)-60000)<.01);solid.delete();
 }
 const path=pathToDrawing(edit.shapes,edit.points);assert.ok(path);
});

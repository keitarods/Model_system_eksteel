const {test}=require('node:test');const assert=require('node:assert/strict');
const {mirrorShapes,offsetShapes,trimExtend,threePointArc}=require('../src/lib/sketch/modify.ts');
const {useSketchStore:s}=require('../src/lib/sketch/store.ts');
const {undoModel,redoModel,useUndoStore:h}=require('../src/lib/history/store.ts');
const points={a:{id:'a',x:0,y:0},b:{id:'b',x:100,y:0},c:{id:'c',x:30,y:-20},d:{id:'d',x:30,y:20},e:{id:'e',x:70,y:-20},f:{id:'f',x:70,y:20}};
const shapes=[{id:'l',type:'line',p1:'a',p2:'b'}, {id:'bound1',type:'line',p1:'c',p2:'d'},{id:'bound2',type:'line',p1:'e',p2:'f'}];
const tick=()=>new Promise(r=>queueMicrotask(r));
test('trim removes only clicked interval and extend chooses closest forward boundary',()=>{
 const edit=trimExtend(shapes,points,'l',{x:50,y:0});assert.equal(edit.shapes.length,2);
 const p={...points,...edit.points};assert.equal(p[edit.shapes[0].p2].x,30);assert.equal(p[edit.shapes[1].p1].x,70);
 const short={...points,b:{id:'b',x:10,y:0}};
 const extension=trimExtend(shapes,short,'l',{x:9,y:0},true);assert.equal(extension.points[extension.shapes[0].p2].x,30);
 assert.equal(points.b.x,100);
});
test('trim uses exact circle intersections and rejects lines without intersections',()=>{
 const circle={id:'circle',type:'circle',center:'o',radius:10};
 const edit=trimExtend([shapes[0],circle],{...points,o:{id:'o',x:50,y:0}},'l',{x:50,y:0});
 assert.deepEqual(Object.values(edit.points).map(p=>p.x).sort((a,b)=>a-b),[40,60]);
 assert.throws(()=>trimExtend([shapes[0]],points,'l',{x:50,y:0}));
});
test('mirror about diagonal retains shared points and clears invalid horizontal lock',()=>{
 const original=[{...shapes[0],axisLock:'horizontal'},{id:'next',type:'line',p1:'b',p2:'d'}];
 const edit=mirrorShapes(original,points,{x:0,y:0},{x:1,y:1});
 assert.equal(edit.shapes[0].p2,edit.shapes[1].p1);
 const p=edit.points[edit.shapes[0].p2];assert.ok(Math.abs(p.x)<1e-8&&Math.abs(p.y-100)<1e-8);assert.equal(edit.shapes[0].axisLock,undefined);
});
test('offset produces exact line/circle offsets and rejects collapsed radii',()=>{
 const edit=offsetShapes([shapes[0]],points,5);assert.ok(Object.values(edit.points).every(p=>p.y===5));
 const c={id:'c',type:'circle',center:'a',radius:10};assert.equal(offsetShapes([c],points,2).shapes[0].radius,12);
 assert.throws(()=>offsetShapes([c],points,-10));assert.throws(()=>offsetShapes([c],points,NaN));
});
test('three point arc supports major arcs using exact minor primitives',()=>{
 const edit=threePointArc({x:10,y:0},{x:-10,y:0},{x:0,y:10});
 assert.ok(edit.shapes.length>=3);
 for(const arc of edit.shapes){const c=edit.points[arc.center];assert.ok(Math.hypot(c.x,c.y)<1e-8);for(const key of [arc.p1,arc.p2])assert.ok(Math.abs(Math.hypot(edit.points[key].x,edit.points[key].y)-10)<1e-8);}
 for(let i=1;i<edit.shapes.length;i++)assert.equal(edit.shapes[i-1].p2,edit.shapes[i].p1);
 assert.throws(()=>threePointArc({x:0,y:0},{x:10,y:0},{x:20,y:0}));
});
test('modification commits as one undo step; constrained trim is refused',async()=>{
 s.getState().clear();s.setState({shapes,points});await tick();h.setState({past:[],future:[]});
 const edit=trimExtend(shapes,points,'l',{x:50,y:0});s.getState().applySketchEdit(edit);await tick();assert.equal(h.getState().past.length,1);
 undoModel();assert.deepEqual(s.getState().shapes,shapes);redoModel();assert.equal(s.getState().shapes.length,4);
 s.setState({shapes,points,fixedPointIds:['a']});s.getState().applySketchEdit(edit);assert.deepEqual(s.getState().shapes,shapes);assert.match(s.getState().modifyError,/restrições/);
});
test('parallel remains persistent after the reference moves and supports undo',async()=>{
 s.getState().clear();s.setState({shapes:[shapes[0],{id:'dep',type:'line',p1:'c',p2:'d'}],points});await tick();h.setState({past:[],future:[]});
 s.getState().makeParallel('l','dep');await tick();assert.equal(s.getState().constraints[0].kind,'parallel');
 s.getState().movePoints({b:{x:100,y:100}});const p=s.getState().points;assert.ok(Math.abs((p.d.x-p.c.x)-(p.d.y-p.c.y))<1e-6);
 undoModel();undoModel();assert.equal(s.getState().constraints.length,0);
});
test('concentric circles share a center after two clicks',()=>{
 s.getState().clear();s.setState({shapes:[{id:'c1',type:'circle',center:'a',radius:10},{id:'c2',type:'circle',center:'b',radius:10}],points});
 s.getState().setTool('concentric');s.getState().handleRawDown({x:0,y:10});s.getState().handleRawDown({x:100,y:10});
 assert.equal(s.getState().shapes[0].center,s.getState().shapes[1].center);
});
test('legacy rectangle mirror produces an exact quadrilateral and closed offset is valid',()=>{
 const p={...points,b:{id:'b',x:100,y:60}};
 const mirror=mirrorShapes([{id:'r',type:'rect',p1:'a',p2:'b'}],p,{x:0,y:0},{x:2,y:1});assert.equal(mirror.shapes.length,4);
 const offset=offsetShapes(mirror.shapes,mirror.points,3);assert.equal(offset.shapes.length,4);
 assert.throws(()=>offsetShapes(mirror.shapes,mirror.points,-1000));
});
test('DXF imports existing exporter output and rejects unsupported entities and non-planar data',()=>{
 const {parseDxf}=require('../src/lib/project/dxfImport.ts');const {buildDxf}=require('../src/lib/project/dxf.ts');
 const edit=parseDxf(buildDxf(shapes,points));assert.equal(edit.shapes.length,3);
 assert.throws(()=>parseDxf('0\nSECTION\n2\nENTITIES\n0\nSPLINE\n0\nENDSEC\n0\nEOF'),/SPLINE/);
 assert.throws(()=>parseDxf('0\nSECTION\n2\nENTITIES\n0\nPOINT\n10\n0\n20\n0\n30\n5\n0\nENDSEC\n0\nEOF'),/2D/);
});
test('mirror and offset can be committed, saved and undone without changing the source',async()=>{
 const {serializeProject,parseProject}=require('../src/lib/project/nativeFormat.ts');
 for(const edit of [mirrorShapes([shapes[0]],points,{x:0,y:0},{x:1,y:1}),offsetShapes([shapes[0]],points,5)]){
  s.getState().clear();s.setState({shapes:[shapes[0]],points});await tick();h.setState({past:[],future:[]});
  s.getState().applySketchEdit(edit);await tick();assert.equal(h.getState().past.length,1);
  const state=s.getState(),feature={id:'s',label:'s',type:'sketch',plane:state.activePlane,shapes:state.shapes,points:state.points,dimensions:[]};
  assert.deepEqual(parseProject(serializeProject([feature])).features,[feature]);
  undoModel();assert.deepEqual(s.getState().shapes,[shapes[0]]);redoModel();assert.equal(s.getState().shapes.length,2);
 }
});
test('DXF independent LINE endpoints weld into an extrudable closed profile',()=>{
 const {parseDxf}=require('../src/lib/project/dxfImport.ts');const {buildDxf}=require('../src/lib/project/dxf.ts');const {findProfileSource}=require('../src/lib/replicad/geometry.ts');
 const p={a:{id:'a',x:0,y:0},b:{id:'b',x:100,y:100}};
 const dxf=buildDxf([{id:'rect',type:'rect',p1:'a',p2:'b'}],p);
 s.getState().clear();s.getState().applySketchEdit(parseDxf(dxf));
 const state=s.getState();assert.equal(findProfileSource(state.shapes,state.points).kind,'loop');
});
test('arc click workflow snaps points, keeps preview out of history and supports cancellation',async()=>{
 s.getState().clear();s.getState().setTool('arc3');await tick();h.setState({past:[],future:[]});
 s.getState().handleRawDown({x:100,y:0});s.getState().handleRawDown({x:0,y:100});s.getState().handleRawMove({x:-100,y:0});
 await tick();assert.ok(s.getState().modifyPreview);assert.equal(h.getState().past.length,0);
 s.getState().handleRawDown({x:-100,y:0});await tick();assert.equal(s.getState().shapes.length,2);assert.equal(h.getState().past.length,1);
 undoModel();assert.equal(s.getState().shapes.length,0);redoModel();assert.equal(s.getState().shapes.length,2);
 s.getState().setTool('arc3');s.getState().handleRawDown({x:200,y:200});s.getState().setTool('select');assert.deepEqual(s.getState().arcPoints,[]);
});
test('trim at an intersection is rejected rather than deleting two adjacent intervals',()=>{
 assert.throws(()=>trimExtend(shapes,points,'l',{x:30,y:0}),/interseção/);
});

const {test}=require('node:test');const assert=require('node:assert/strict');
const {useSketchStore:s}=require('../src/lib/sketch/store.ts');const {undoModel,redoModel,useUndoStore:h}=require('../src/lib/history/store.ts');
const {layerGeometry}=require('../src/lib/sketch/layers.ts');const tick=()=>new Promise(r=>queueMicrotask(r));
test('layers inherit on creation, hide snap/selection candidates and restore through history',async()=>{
 s.getState().clear();await tick();h.setState({past:[],future:[]});
 s.setState({layers:[...s.getState().layers,{id:'test',name:'Test',visible:true,locked:false}],activeLayerId:'test'});
 s.getState().setTool('line');s.getState().handleRawDown({x:100,y:100});s.getState().handleRawUp({x:200,y:100});await tick();
 assert.equal(s.getState().shapes[0].layerId,'test');
 s.setState({layers:s.getState().layers.map(l=>l.id==='test'?{...l,visible:false}:l)});await tick();
 assert.equal(layerGeometry(s.getState()).shapes.length,0);
 assert.ok(!Object.values(layerGeometry(s.getState()).points).some(p=>p.x===200));
 undoModel();assert.equal(layerGeometry(s.getState()).shapes.length,1);redoModel();assert.equal(layerGeometry(s.getState()).shapes.length,0);
});
test('locked layer prevents point edits and deletion without losing geometry',()=>{
 s.getState().clear();s.setState({layers:[{id:'0',name:'Locked',locked:true,visible:true}],points:{a:{id:'a',x:0,y:0},b:{id:'b',x:100,y:0}},shapes:[{id:'l',type:'line',p1:'a',p2:'b'}]});
 s.getState().movePoints({b:{x:120,y:20}});assert.equal(s.getState().points.b.x,100);s.getState().removeShape('l');assert.equal(s.getState().shapes.length,1);
 s.getState().setTool('select');s.getState().handleRawDown({x:50,y:0});assert.equal(s.getState().selectedShapeId,null);
});
test('angular dimension drives and retains a directed angle without changing length',async()=>{
 s.getState().clear();s.setState({points:{a:{id:'a',x:0,y:0},b:{id:'b',x:100,y:0},c:{id:'c',x:0,y:100},d:{id:'d',x:100,y:100}},shapes:[{id:'ref',type:'line',p1:'a',p2:'b'},{id:'dep',type:'line',p1:'c',p2:'d'}]});await tick();h.setState({past:[],future:[]});
 s.getState().makeAngle('ref','dep',30);await tick();let p=s.getState().points;
 assert.ok(Math.abs(p.d.x-100*Math.cos(Math.PI/6))<1e-8);assert.ok(Math.abs(p.d.y-150)<1e-8);
 undoModel();assert.equal(s.getState().constraints.length,0);redoModel();assert.equal(s.getState().constraints[0].degrees,30);
 s.getState().movePoints({b:{x:0,y:100}});p=s.getState().points;assert.ok(Math.abs(Math.atan2(p.d.y-p.c.y,p.d.x-p.c.x)*180/Math.PI-120)<1e-8);
 const previous=s.getState().constraints;s.getState().makeAngle('ref','dep',NaN);assert.equal(s.getState().constraints,previous);
});
test('diameter dimensions edit and evaluate formula references in diameter units',()=>{
 s.getState().clear();s.setState({points:{a:{id:'a',x:0,y:0},b:{id:'b',x:100,y:0}},shapes:[{id:'c1',type:'circle',center:'a',radius:10},{id:'c2',type:'circle',center:'b',radius:5}]});
 s.getState().addDimension({id:'d1',kind:'radius',circleId:'c1',isDiameter:true});
 s.getState().addDimension({id:'d2',kind:'radius',circleId:'c2'});
 s.getState().updateDimensionValue(s.getState().dimensions[0],'30');assert.equal(s.getState().shapes[0].radius,15);
 s.getState().updateDimensionValue(s.getState().dimensions[1],'d1/2');assert.equal(s.getState().shapes[1].radius,15);
 s.getState().updateDimensionValue(s.getState().dimensions[0],'40');assert.equal(s.getState().shapes[0].radius,20);assert.equal(s.getState().shapes[1].radius,20);
});

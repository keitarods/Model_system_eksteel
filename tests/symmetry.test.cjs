const {test}=require('node:test');const assert=require('node:assert/strict');
const {useSketchStore:s}=require('../src/lib/sketch/store.ts');const {undoModel,redoModel,useUndoStore:h}=require('../src/lib/history/store.ts');
const tick=()=>new Promise(r=>queueMicrotask(r));
test('symmetry persists after moving source and axis, and survives undo/redo',async()=>{
 s.getState().clear();
 s.setState({points:{a:{id:'a',x:20,y:30},b:{id:'b',x:70,y:20},x:{id:'x',x:0,y:-100},y:{id:'y',x:0,y:100}},shapes:[{id:'axis',type:'line',p1:'x',p2:'y'},{id:'a',type:'point',pointId:'a'},{id:'b',type:'point',pointId:'b'}]});await tick();h.setState({past:[],future:[]});
 s.getState().setTool('symmetric');for(const p of [{x:20,y:30},{x:70,y:20},{x:0,y:60}])s.getState().handleRawDown(p);
 await tick();assert.equal(s.getState().constraints[0].kind,'symmetric');assert.equal(s.getState().points.b.x,-20);assert.equal(s.getState().points.b.y,30);
 undoModel();assert.equal(s.getState().constraints.length,0);redoModel();assert.equal(s.getState().constraints.length,1);
 s.getState().movePoints({a:{x:40,y:50}});assert.equal(s.getState().points.b.x,-40);assert.equal(s.getState().points.b.y,50);
 s.getState().movePoints({x:{x:10,y:-100},y:{x:10,y:100}});assert.equal(s.getState().points.b.x,-20);
});
test('joining spline control points remaps their references instead of leaving dangling IDs',()=>{
 s.getState().clear();s.setState({points:{a:{id:'a',x:0,y:0},b:{id:'b',x:100,y:0},c:{id:'c',x:0,y:100},d:{id:'d',x:100,y:100},new:{id:'new',x:10,y:100}},shapes:[{id:'curve',type:'spline',p1:'a',p2:'b',control1:'c',control2:'d'}]});
 s.getState().joinPoints('new','c');assert.equal(s.getState().shapes[0].control1,'new');assert.equal(s.getState().points.c,undefined);
});

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { useSketchStore: sketch } = require('../src/lib/sketch/store.ts');
const { useUndoStore: history, undoModel, redoModel } = require('../src/lib/history/store.ts');
const { regularPolygon } = require('../src/lib/sketch/polygon.ts');
const { snapToGrid, resolveSnapWithEdges } = require('../src/lib/sketch/snap.ts');
const { serializeProject, parseProject } = require('../src/lib/project/nativeFormat.ts');
const tick = () => new Promise(resolve => queueMicrotask(resolve));
beforeEach(async () => {
  sketch.getState().clear();
  sketch.setState({ tool: 'select', polygonSides: 6, gridSize: 10 });
  await tick(); history.setState({ past: [], future: [] });
});
test('undo restores constraints, fixed points and parameter numbering; redo restores edits', async () => {
  sketch.setState({ constraints: [{id:'c',kind:'pointOnLine',pointId:'a',lineId:'l'}], fixedPointIds:['a'], nextParamNumber:9 });
  undoModel();
  assert.deepEqual(sketch.getState().constraints, []);
  assert.deepEqual(sketch.getState().fixedPointIds, []);
  assert.equal(sketch.getState().nextParamNumber, 1);
  await tick(); assert.equal(history.getState().past.length, 0);
  redoModel(); assert.equal(sketch.getState().constraints.length, 1);
  assert.deepEqual(sketch.getState().fixedPointIds, ['a']);
  assert.equal(sketch.getState().nextParamNumber, 9);
});
test('preview does not enter history; a new edit invalidates redo', async () => {
  sketch.setState({ draftPoint: {x:12,y:13} }); await tick();
  assert.equal(history.getState().past.length,0);
  sketch.setState({ fixedPointIds:['a'] }); undoModel();
  sketch.setState({ fixedPointIds:['b'] }); redoModel();
  assert.deepEqual(sketch.getState().fixedPointIds,['b']);
  assert.equal(history.getState().future.length,0);
});
test('polygon pointer workflow uses grid, closed shared vertices and one undo step', async () => {
  sketch.getState().setTool('polygon');
  sketch.getState().handleRawDown({x:102,y:102});
  sketch.getState().handleRawMove({x:142,y:102});
  assert.deepEqual(sketch.getState().draftPoint,{x:140,y:100});
  sketch.getState().handleRawUp({x:142,y:102});
  const { shapes, points } = sketch.getState();
  assert.equal(shapes.length,6);
  for (let i=0;i<6;i++) {
    assert.equal(shapes[i].p2,shapes[(i+1)%6].p1);
    const p=points[shapes[i].p1]; assert.ok(Math.abs(Math.hypot(p.x-100,p.y-100)-40)<1e-8);
  }
  await tick(); assert.equal(history.getState().past.length,1);
  undoModel(); assert.equal(sketch.getState().shapes.length,0);
  redoModel(); assert.deepEqual(sketch.getState().shapes,shapes);
  const feature={id:'s',type:'sketch',label:'Polygon',plane:sketch.getState().activePlane,shapes,points,dimensions:[]};
  assert.deepEqual(parseProject(serializeProject([feature])).features,[feature]);
});
test('polygon rejects invalid/degenerate input and remains regular for 3–128 sides', () => {
  for (const n of [0,2,129,3.5,Infinity,NaN]) assert.deepEqual(regularPolygon({x:0,y:0},{x:10,y:0},n),[]);
  assert.deepEqual(regularPolygon({x:0,y:0},{x:0,y:0},6),[]);
  for (const n of [3,4,6,128]) {
    const p=regularPolygon({x:-31,y:7},{x:11,y:22},n);
    const lengths=p.map((v,i)=>Math.hypot(v.x-p[(i+1)%n].x,v.y-p[(i+1)%n].y));
    assert.ok(Math.max(...lengths)-Math.min(...lengths)<1e-9);
  }
});
test('snap prioritizes existing vertices and invalid grid does not generate NaN', () => {
  const raw={x:11,y:9};
  for (const grid of [0,-1,NaN,Infinity]) assert.deepEqual(snapToGrid(raw,grid),raw);
  assert.deepEqual(snapToGrid(raw,10),{x:10,y:10});
  const snap=resolveSnapWithEdges(raw,{a:{id:'a',x:12,y:8}},[],[],10,6);
  assert.equal(snap.existingId,'a'); assert.deepEqual(snap.point,{x:12,y:8});
});
test('Escape-equivalent cancellation creates no polygon', async () => {
  sketch.getState().setTool('polygon'); sketch.getState().handleRawDown({x:100,y:100});
  sketch.getState().setTool('select'); sketch.getState().handleRawUp({x:140,y:100});
  await tick(); assert.equal(sketch.getState().shapes.length,0); assert.equal(history.getState().past.length,0);
});
test('rectangle derived corners remain orthogonal near unrelated snap targets', () => {
  sketch.setState({points:{origin:{id:'origin',x:0,y:0},near:{id:'near',x:142,y:102}}});
  sketch.getState().setTool('rect');
  sketch.getState().handleRawDown({x:100,y:100});
  sketch.getState().handleRawUp({x:140,y:140});
  const {shapes,points}=sketch.getState(); assert.equal(shapes.length,4);
  for (const line of shapes) {
    const a=points[line.p1],b=points[line.p2];
    assert.equal(line.axisLock==='horizontal' ? a.y : a.x,line.axisLock==='horizontal' ? b.y : b.x);
  }
});
test('fillet and chamfer numeric controls reject non-finite values', () => {
  const {filletRadius,chamferDistance}=sketch.getState();
  sketch.getState().setFilletRadius(NaN); sketch.getState().setChamferDistance(Infinity);
  assert.equal(sketch.getState().filletRadius,filletRadius);
  assert.equal(sketch.getState().chamferDistance,chamferDistance);
});

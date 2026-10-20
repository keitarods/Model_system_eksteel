const {test}=require('node:test');const assert=require('node:assert/strict');
const {useSketchStore:s}=require('../src/lib/sketch/store.ts');
function setup(){s.getState().clear();s.setState({points:{a:{id:'a',x:10,y:10},b:{id:'b',x:50,y:10},c:{id:'c',x:50,y:30},d:{id:'d',x:10,y:30}},shapes:[['ab','a','b','horizontal'],['bc','b','c','vertical'],['cd','c','d','horizontal'],['da','d','a','vertical']].map(([id,p1,p2,axisLock])=>({id,type:'line',p1,p2,axisLock})),dimensions:[{id:'w',kind:'distance',p1:'a',p2:'b',offset:5},{id:'h',kind:'distance',p1:'b',p2:'c',offset:5}],constraints:[],fixedPointIds:[]});}
test('changing rectangle width moves the whole side while preserving its height dimension',()=>{
 setup();s.getState().updateDistanceDimension('w',60);const p=s.getState().points;
 assert.equal(p.b.x,70);assert.equal(p.c.x,70);assert.equal(p.c.y-p.b.y,20);assert.equal(p.d.x,10);
 s.getState().updateDistanceDimension('h',35);const q=s.getState().points;
 assert.equal(q.c.y,45);assert.equal(q.d.y,45);assert.equal(q.c.x-q.d.x,60);
});
test('conflicting dimensions leave all corners unchanged instead of distorting the rectangle',()=>{
 setup();s.setState({dimensions:[...s.getState().dimensions,{id:'top',kind:'distance',p1:'d',p2:'c',offset:5}]});
 const before=s.getState().points;s.getState().updateDistanceDimension('w',60);assert.deepEqual(s.getState().points,before);
});
test('distance between rectangle sides also preserves the adjacent dimension',()=>{
 setup();s.setState({dimensions:[{id:'w',kind:'edgeDistance',a:{kind:'line',lineId:'da'},b:{kind:'line',lineId:'bc'},offset:5},s.getState().dimensions[1]]});
 s.getState().updateEdgeDistanceDimension('w',60);const p=s.getState().points;
 assert.equal(p.b.x-p.a.x,60);assert.equal(p.c.x,p.b.x);assert.equal(p.c.y-p.b.y,20);
});

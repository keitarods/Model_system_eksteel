const {test}=require('node:test');const assert=require('node:assert/strict');
const {windowDimensions,draggedDimensionOffset,dimensionBounds}=require('../src/lib/drawing/dimensionSelection.ts');
const d={id:'a',viewId:'v',x1:10,y1:10,x2:50,y2:10,offset:10,value:40};
test('window selection distinguishes containment and crossing at paper coordinates',()=>{
 assert.deepEqual(windowDimensions([d],{x:0,y:0},{x:60,y:30}),['a']);
 assert.deepEqual(windowDimensions([d],{x:20,y:15},{x:40,y:25}),[]);
 assert.deepEqual(windowDimensions([d],{x:40,y:25},{x:20,y:15}),['a']);
 assert.deepEqual(windowDimensions([d],{x:60,y:60},{x:70,y:70}),[]);
});
test('group dragging changes only the offset in each dimension direction',()=>{
 assert.equal(draggedDimensionOffset(d,5,7),17);
 assert.equal(draggedDimensionOffset({...d,x2:10,y2:50},5,7),5);
 const angular={...d,offset:14,angular:{start:0,delta:Math.PI/2}};
 assert.ok(Math.abs(draggedDimensionOffset(angular,10,10)-(14+Math.sqrt(200)))<1e-9);
 assert.equal(draggedDimensionOffset(angular,-100,-100),6);
 assert.equal(d.x1,10);assert.equal(d.value,40);
 assert.ok(dimensionBounds(angular).right>d.x1);
});

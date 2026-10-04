const {test}=require('node:test');const assert=require('node:assert/strict');
const {autoDimensions,bendSchedule}=require('../src/lib/drawing/autoDimensions.ts');
const base={id:'v',orientation:'front',x:100,y:100,scale:0.1,box:{minX:0,minY:0,width:100,height:50}};
test('tiny projected fragments do not flood the sheet at reduced scales',()=>{
 const lineEdges=Array.from({length:10},(_,i)=>({x1:i*10,y1:0,x2:(i+1)*10,y2:0}));
 const dims=autoDimensions({...base,lineEdges});
 assert.equal(dims.filter(d=>d.value===10).length,0);
 assert.equal(dims.length,2);
});
test('whole flange edges remain dimensioned when other vertices split their span',()=>{
 const dims=autoDimensions({...base,scale:1,lineEdges:[{x1:0,y1:0,x2:40,y2:0},{x1:20,y1:20,x2:20,y2:50},{x1:40,y1:0,x2:70,y2:40}]});
 assert.ok(dims.some(d=>d.value===40));assert.ok(dims.some(d=>d.value===50));
});
test('bend notes preserve signed model rotation and true flange parameters',()=>{
 const notes=bendSchedule([{label:'Aba lateral',length:37.5,angle:-45,innerRadius:2}]);
 assert.match(notes[2].text,/37,5 mm/);assert.match(notes[2].text,/Giro -45°/);assert.match(notes[2].text,/Ri 2 mm/);
 assert.match(notes[1].text,/antes de dobrar/);
});

test('dimension references use actual extremities and hidden edges are excluded',()=>{
 const outline=[{x1:0,y1:20,x2:50,y2:0},{x1:50,y1:0,x2:100,y2:20},{x1:100,y1:20,x2:100,y2:50},{x1:100,y1:50,x2:0,y2:50},{x1:0,y1:50,x2:0,y2:20}];
 const view={...base,scale:1,visibleLineEdges:outline,lineEdges:[...outline,{x1:10,y1:10,x2:33,y2:10}]};
 const dims=autoDimensions(view);
 assert.deepEqual(dims[0].reference1,{x:50,y:95});
 assert.deepEqual(dims[0].reference2,{x:150,y:95});
 assert.ok(!dims.some(d=>d.value===23));
 const {labelBox}=require('../src/lib/drawing/autoDimensions.ts');
 const boxes=dims.map(labelBox);
 for(let i=0;i<boxes.length;i++) for(let j=i+1;j<boxes.length;j++) {
  const a=boxes[i],b=boxes[j];
  assert.ok(!(a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y));
 }
});

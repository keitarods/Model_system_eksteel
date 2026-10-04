const {test}=require('node:test');const assert=require('node:assert/strict');
const {circularArc,fullContourLines}=require('../src/lib/drawing/roundedContour.ts');
const {autoRadiusNotes}=require('../src/lib/drawing/autoDimensions.ts');
const arc={x:90,y:10,radius:10,start:{x:90,y:0},mid:{x:90+10/Math.sqrt(2),y:10-10/Math.sqrt(2)},end:{x:100,y:10}};
test('rounded flange sides extend to the theoretical full corner, not tangency',()=>{
 const lines=[{x1:0,y1:0,x2:90,y2:0},{x1:100,y1:10,x2:100,y2:50}];
 const result=fullContourLines(lines,[arc]);
 assert.deepEqual(result,[{x1:0,y1:0,x2:100,y2:0},{x1:100,y1:0,x2:100,y2:50}]);
 assert.equal(lines[0].x2,90);
});
test('non-tangent edges and parallel sides are not extended speculatively',()=>{
 const lines=[{x1:0,y1:5,x2:90,y2:0},{x1:100,y1:10,x2:100,y2:50}];
 assert.deepEqual(fullContourLines(lines,[arc]),lines);
});
test('circular CAD arc recovers exact radius and groups equal radii',()=>{
 const recovered=circularArc(arc.start,arc.mid,arc.end);
 assert.ok(Math.abs(recovered.radius-10)<1e-9);
 const other={...arc,x:20,mid:{x:25,y:25},radius:5};
 const notes=autoRadiusNotes({id:'v',orientation:'top',x:100,y:100,scale:0.5,box:{minX:0,minY:0,width:100,height:50},arcs:[arc,{...arc,mid:{x:20,y:10}},other]});
 assert.equal(notes.length,2);assert.equal(notes[0].text,'2 × R10');assert.equal(notes[1].text,'R5');
 assert.ok(Math.abs(notes[0].x1-(100+(arc.mid.x-50)*0.5))<1e-8);
});

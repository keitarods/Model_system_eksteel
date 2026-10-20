const {test}=require('node:test');const assert=require('node:assert/strict');
const {flatBendDimension}=require('../src/lib/drawing/flatBendDimension.ts');
const {autoDimensions}=require('../src/lib/drawing/autoDimensions.ts');
const line=(x1,y1,x2,y2)=>({x1,y1,x2,y2});
const bend={id:'logo',angle:90,line:line(0,40,100,40),panel:line(0,40,0,160),width:line(0,160,100,160)};
const view={id:'flat',orientation:'top',flattened:true,scale:1,x:100,y:100,box:{minX:0,minY:0,width:100,height:200},lineEdges:[line(0,0,100,0),line(100,0,100,200),line(100,200,0,200),line(0,200,0,0),line(40,10,60,10),line(40,20,60,20)],flatBends:[bend]};
test('base panel uses external extremity, not the next bend or internal logo cuts',()=>{
 assert.deepEqual(flatBendDimension(view,bend),line(50,0,50,40));
 for(const scale of [.25,1,2]){
 const d=autoDimensions({...view,scale}).find(d=>d.bendId==='logo');
 assert.equal(d.value,40);assert.equal(d.suffix,' (90°)');assert.equal(Math.abs(d.y2-d.y1),40*scale);
 }
});
test('rounded outside boundary is intersected on its actual arc',()=>{
 const curved={...view,lineEdges:[line(0,200,100,200)],arcs:[{x:50,y:10,radius:10,start:{x:40,y:10},mid:{x:50,y:0},end:{x:60,y:10}}]};
 assert.deepEqual(flatBendDimension(curved,bend),line(50,0,50,40));
});
test('rotated bend measures perpendicular to the bend at true distance',()=>{
 const rotate=p=>({x:(p.x-p.y)/Math.sqrt(2),y:(p.x+p.y)/Math.sqrt(2)});
 const transform=l=>{const a=rotate({x:l.x1,y:l.y1}),b=rotate({x:l.x2,y:l.y2});return line(a.x,a.y,b.x,b.y);};
 const d=flatBendDimension({...view,lineEdges:view.lineEdges.map(transform)},{...bend,line:transform(bend.line)});
 assert.ok(Math.abs(Math.hypot(d.x2-d.x1,d.y2-d.y1)-40)<1e-6);
});

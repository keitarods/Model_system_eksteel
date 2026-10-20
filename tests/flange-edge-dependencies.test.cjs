const {test}=require('node:test');const assert=require('node:assert/strict');
const {rebuildModel,editFlangeWithDependents}=require('../src/lib/replicad/build-model.ts');
const {pointOnFlange}=require('../src/lib/replicad/sheetMetal.ts');
test('edge finishes follow a flange edit and survive repeated edits without mutating the original',async()=>{
 await require('./kernel.cjs')();
 const base=[{id:'rule',type:'sheetMetal',thickness:2,label:'Regra'},{id:'base',type:'face',label:'Base',plane:{origin:[0,0,0],normal:[0,0,1],xDir:[1,0,0]},profile:{kind:'rect',x1:0,y1:0,x2:40,y2:30}},{id:'bend',type:'flange',label:'Dobra',parentId:'base',edgeStart:[0,0,2],edgeEnd:[40,0,2],length:12,angle:90,innerRadius:3}];
 let oldLink;rebuildModel(base,{onFlange:(_,link)=>oldLink=link}).delete();
 for(const type of ['fillet','chamfer']) {
  const finish={id:'finish',type,label:'Acabamento',radius:.5,distance:.5,edgePoints:[pointOnFlange(oldLink,[.5,1,0])]};
  const original=[...base,finish];const snapshot=JSON.stringify(original);
  rebuildModel(original).delete();
  let current=original;
  for(const change of [{length:22},{angle:65},{innerRadius:4}]) {
   current=editFlangeWithDependents(current,{...current[2],...change});
   let link;const solid=rebuildModel(current,{onFlange:(_,value)=>link=value});
   try {assert.ok(solid.mesh().triangles.length);assert.deepEqual(current[3].edgePoints,[pointOnFlange(link,[.5,1,0])]);}
   finally {solid.delete();}
  }
  assert.equal(JSON.stringify(original),snapshot);
 }
});

const {test}=require('node:test');const assert=require('node:assert/strict');
const {rebuildModel}=require('../src/lib/replicad/build-model.ts');
const {pointOnFlange,undoFlattenChain}=require('../src/lib/replicad/sheetMetal.ts');
const r=require('replicad');
test('fillets on flange tip thickness edges are relocated to the developed panel',async()=>{
 await require('./kernel.cjs')();
 const features=[{id:'rule',type:'sheetMetal',thickness:2,label:'Rule'},{id:'base',type:'face',label:'Base',plane:{origin:[0,0,0],normal:[0,0,1],xDir:[1,0,0]},profile:{kind:'rect',x1:0,y1:0,x2:60,y2:50}},{id:'bend',type:'flange',label:'Bend',parentId:'base',edgeStart:[0,0,2],edgeEnd:[60,0,2],length:30,angle:90,innerRadius:3}];
 for (const angle of [45,90]) {
 features[2].angle=angle;
 let link;const initial=rebuildModel(features,{onFlange:(_,l)=>{link=l;}});initial.delete();
 const points=[pointOnFlange(link,[0,1,-.5]),pointOnFlange(link,[1,1,-.5])];
 const fillet={id:'f',type:'fillet',label:'R10',radius:10,edgePoints:points};
 const folded=rebuildModel([...features,fillet]);folded.delete();
 const plain=rebuildModel(features,{flatten:true});
 const flat=rebuildModel([...features,fillet],{flatten:true});
 const {findEdgesByPoints}=require('../src/lib/replicad/edgeTools.ts');
 const edges=findEdgesByPoints(plain,points.map(p=>undoFlattenChain([link],p)));
 const expected=plain.fillet(10,f=>f.inList(edges));edges.forEach(e=>e.delete());
 try {
  assert.ok(flat.mesh().triangles.length);
  assert.ok(r.measureVolume(flat)<r.measureVolume(plain));
  assert.ok(Math.abs(r.measureVolume(flat)-r.measureVolume(expected))<1e-5);
 }finally{flat.delete();plain.delete();expected.delete();}
 }
});

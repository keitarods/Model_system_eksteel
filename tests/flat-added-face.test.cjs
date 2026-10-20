const {test}=require('node:test');const assert=require('node:assert/strict');
const {rebuildModel}=require('../src/lib/replicad/build-model.ts');
const {pointOnFlange}=require('../src/lib/replicad/sheetMetal.ts');
const {measureVolume}=require('replicad');
test('Face additions and cuts on a flange follow the panel into the flat pattern',async()=>{
 await require('./kernel.cjs')();
 const features=[{id:'r',type:'sheetMetal',thickness:2,label:'Rule'},{id:'base',type:'face',label:'Base',plane:{origin:[0,0,0],normal:[0,0,1],xDir:[1,0,0]},profile:{kind:'rect',x1:0,y1:0,x2:40,y2:30}},{id:'bend',type:'flange',label:'Bend',parentId:'base',edgeStart:[0,0,2],edgeEnd:[40,0,2],length:30,angle:90,innerRadius:3}];
 for(const angle of [40,45,90]) {
  features[2].angle=angle;let link;rebuildModel(features,{onFlange:(_,l)=>link=l}).delete();
  const origin=pointOnFlange(link,[0,0,0]);
  const outer=pointOnFlange(link,[0,0,-1]);
  const normal=outer.map((v,i)=>(v-origin[i])/2);
  const plane={origin,normal,xDir:link.axisDir};
  const addition={id:'added',type:'face',label:'Face on flange',plane,profile:{kind:'rect',x1:0,y1:0,x2:40,y2:40}};
  const cut={id:'cut',type:'face',label:'Cut on flange',plane,cut:true,profile:{kind:'circle',cx:20,cy:15,r:2}};
  const plain=rebuildModel([...features,addition],{flatten:true});
  const flat=rebuildModel([...features,addition,cut],{flatten:true});
  try{
   assert.ok(flat.mesh().triangles.length);
   assert.ok(Math.abs(flat.boundingBox.depth-2)<0.01, `flat thickness ${flat.boundingBox.depth}`);
   assert.ok(Math.abs(measureVolume(plain)-measureVolume(flat)-8*Math.PI)<1e-5);
  }finally{plain.delete();flat.delete();}
  const {localToWorldPoint}=require('../src/lib/replicad/plane.ts');
  const child={id:'child',type:'flange',label:'Flange on added Face',parentId:'added',
    edgeStart:localToWorldPoint(plane,{x:0,y:40}).map((v,i)=>v+2*normal[i]),
    edgeEnd:localToWorldPoint(plane,{x:40,y:40}).map((v,i)=>v+2*normal[i]),length:61,angle:40};
  const complete=rebuildModel([...features,addition,cut,child],{flatten:true});
  try {assert.ok(complete.mesh().triangles.length);assert.ok(Math.abs(complete.boundingBox.depth-2)<.01);}
  finally {complete.delete();}
 }
});
test('an unsupported tilted Face cannot be presented as a successful flat pattern',async()=>{
 await require('./kernel.cjs')();
 const features=[{id:'r',type:'sheetMetal',thickness:2,label:'Rule'},
 {id:'base',type:'face',label:'Base',plane:{origin:[0,0,0],normal:[0,0,1],xDir:[1,0,0]},profile:{kind:'rect',x1:0,y1:0,x2:40,y2:30}},
 {id:'bad',type:'face',label:'Unattached tilted panel',plane:{origin:[0,0,0],normal:[0,1,0],xDir:[1,0,0]},profile:{kind:'rect',x1:0,y1:0,x2:40,y2:30}}];
 assert.throws(()=>rebuildModel(features,{flatten:true}), error => {
  assert.match(error.message,/verificação final da peça/);
  assert.match(error.message,/extensão normal/);
  assert.doesNotMatch(error.message,/operação \"/);
  return true;
 });
});
test('two slots cut from inside the sheet thickness follow their panel when flattened',async()=>{
 await require('./kernel.cjs')();
 const base=[{id:'r',type:'sheetMetal',thickness:2,label:'Rule'},{id:'base',type:'face',label:'Base',plane:{origin:[0,0,0],normal:[0,0,1],xDir:[1,0,0]},profile:{kind:'rect',x1:0,y1:0,x2:60,y2:40}},{id:'bend',type:'flange',label:'Bend',parentId:'base',edgeStart:[0,0,2],edgeEnd:[60,0,2],length:40,angle:90,innerRadius:3}];
 let link;rebuildModel(base,{onFlange:(_,l)=>link=l}).delete();
 const origin=pointOnFlange(link,[0,0,-.25]);
 const top=pointOnFlange(link,[0,0,0]),bottom=pointOnFlange(link,[0,0,-1]);
 const plane={origin,normal:bottom.map((v,i)=>(v-top[i])/2),xDir:link.axisDir};
 const cut={id:'cut',type:'face',label:'Two slots',plane,cut:true,direction:'symmetric',cutDepth:10,profile:[10,40].map(x=>({kind:'slot',c1:{x,y:15},c2:{x:x+8,y:15},r:2}))};
 const expected=2*(8*4+Math.PI*4)*2;
 for(const flatten of [false,true]) {
  const plain=rebuildModel(base,{flatten}),result=rebuildModel([...base,cut],{flatten});
  try{assert.ok(Math.abs(measureVolume(plain)-measureVolume(result)-expected)<1e-5);assert.ok(result.mesh().triangles.length);}
  finally{plain.delete();result.delete();}
 }
});

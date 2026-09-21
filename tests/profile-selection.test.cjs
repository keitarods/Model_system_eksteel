const {test}=require('node:test');const assert=require('node:assert/strict');
const {findProfileSources}=require('../src/lib/replicad/geometry.ts');
const {rebuildModel}=require('../src/lib/replicad/build-model.ts');
const {serializeProject,parseProject}=require('../src/lib/project/nativeFormat.ts');
test('selected sketch profiles alone become additive or cutting features and survive native files',async()=>{
 await require('./kernel.cjs')();const r=require('replicad');
 const points={a:{x:0,y:0},b:{x:10,y:10},c:{x:20,y:0},d:{x:25,y:10},o:{x:5,y:5},loose:{x:40,y:0}};
 const shapes=[{id:'one',type:'rect',p1:'a',p2:'b'},{id:'two',type:'rect',p1:'c',p2:'d'},{id:'hole',type:'circle',center:'o',radius:2},{id:'open',type:'line',p1:'d',p2:'loose'}];
 const profiles=findProfileSources(shapes,points,shapes.map(s=>s.id));assert.equal(profiles.length,3);
 const plane={origin:[0,0,0],normal:[0,0,1],xDir:[1,0,0]};
 const feature={id:'e',type:'extrude',label:'Selected',plane,profile:[profiles[1]],depth:3};
 const check=(features,volume)=>{const solid=rebuildModel(parseProject(serializeProject(features)).features);try{assert.ok(Math.abs(r.measureVolume(solid)-volume)<1e-5);}finally{solid.delete();}};
 check([feature],150);
 check([{...feature,profile:[profiles[0],profiles[1]]}],450);
 check([{...feature,profile:profiles[0]},{...feature,id:'cut',cut:true,profile:[profiles[2]]}],300-Math.PI*4*3);
 check([{id:'rule',type:'sheetMetal',label:'Rule',thickness:2},{id:'face',type:'face',label:'Face',plane,profile:[profiles[1]]}],100);
 assert.equal(findProfileSources(shapes,points,['open']).length,0);
});

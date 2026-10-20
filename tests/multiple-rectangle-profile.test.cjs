const {test}=require('node:test');const assert=require('node:assert/strict');
const {sketchOperationProfile}=require('../src/lib/replicad/geometry.ts');
const {rebuildModel}=require('../src/lib/replicad/build-model.ts');
const {measureVolume}=require('replicad');
test('two independent rectangles made of lines enable and build a sheet Face together',async()=>{
 await require('./kernel.cjs')();const points={},shapes=[];
 for(const [prefix,x] of [['a',0],['b',20]]) {
  [[x,0],[x+10,0],[x+10,5],[x,5]].forEach(([x,y],i)=>points[prefix+i]={id:prefix+i,x,y});
  for(let i=0;i<4;i++)shapes.push({id:prefix+'e'+i,type:'line',p1:prefix+i,p2:prefix+((i+1)%4)});
 }
 const profile=sketchOperationProfile(shapes,points);assert.equal(profile.length,2);
 const plane={origin:[0,0,0],normal:[0,0,1],xDir:[1,0,0]};
 const solid=rebuildModel([{id:'rule',type:'sheetMetal',label:'Chapa',thickness:2},{id:'face',type:'face',label:'Face',profile,plane}]);
 try{assert.ok(Math.abs(measureVolume(solid)-200)<1e-6);}finally{solid.delete();}
 // Open contours cannot activate Face, and explicit missing boundaries stay invalid.
 assert.equal(sketchOperationProfile(shapes.slice(0,3),points),null);
 assert.equal(sketchOperationProfile(shapes,points,[['missing']]),null);
});

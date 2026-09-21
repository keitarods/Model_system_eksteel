const {test}=require('node:test');const assert=require('node:assert/strict');
const {rebuildModel}=require('../src/lib/replicad/build-model.ts');
const {rebuildVisibleModel}=require('../src/lib/replicad/visibleModel.ts');
test('hidden imported body stays in full geometry while independent later feature remains displayed',async()=>{
 await require('./kernel.cjs')();const r=require('replicad');
 const source=r.makeBox([0,0,0],[10,10,10]);
 const imported={id:'i',type:'imported',label:'STEP',format:'step',brep:source.serialize(),visible:false};source.delete();
 const added={id:'a',type:'extrude',label:'New',plane:{origin:[20,0,0],normal:[0,0,1],xDir:[1,0,0]},profile:{kind:'rect',x1:0,y1:0,x2:5,y2:5},depth:2,cut:false};
 const full=rebuildModel([imported,added]),display=rebuildVisibleModel([imported,added]);
 try{assert.ok(Math.abs(r.measureVolume(full)-1050)<1e-5);assert.ok(Math.abs(r.measureVolume(display)-50)<1e-5);assert.equal(imported.suppressed,undefined);}finally{full.delete();display.delete();}
 assert.equal(rebuildVisibleModel([imported]),null);
 const restored=rebuildVisibleModel([{...imported,visible:true}]);try{assert.ok(Math.abs(r.measureVolume(restored)-1000)<1e-5);}finally{restored.delete();}
});

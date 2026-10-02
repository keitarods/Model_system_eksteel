const {test}=require('node:test');const assert=require('node:assert/strict');
const {resultValues,fieldRange,fieldHue}=require('../src/lib/simulation/resultFields.ts');
function study(){return {material:{yieldStress:200},regionMaterials:{'2':{yieldStress:400}},mesh:{regions:[{id:2,elements:[1]}]},results:{elementVonMises:[400,200,0],elementStress:[[1,-2,3,4,-5,6],[7,8,9,10,11,12]],elementStrain:[[.1,0,0],[.2,0,0]],displacements:[[1,-2,3],[0,4,-1]],displacementMagnitude:[Math.sqrt(14),Math.sqrt(17)]}};}
test('heatmaps map global tensor components and signed nodal displacement correctly',()=>{
 const s=study();
 for(const [field,index] of Object.entries({stressX:0,stressY:1,stressZ:2,shearXY:3,shearYZ:4,shearXZ:5}))assert.deepEqual(resultValues(s,field),{values:s.results.elementStress.map(v=>v[index]),nodal:false});
 assert.deepEqual(resultValues(s,'displacementY'),{values:[-2,4],nodal:true});
 assert.deepEqual(fieldRange(s,'displacementY'),[-2,4]);
 assert.deepEqual(resultValues(s,'stress').values,[400,200,0]);
});
test('safety heatmap uses per-region yield, caps unloaded elements, and highlights failure red',()=>{
 const s=study();assert.deepEqual(resultValues(s,'safety').values,[.5,2,10]);
 assert.deepEqual(fieldRange(s,'safety'),[0,10]);assert.equal(fieldHue(.5,0,10,'safety'),0);
 assert.ok(fieldHue(2,0,10,'safety')>0);assert.equal(fieldHue(10,0,10,'safety'),.33);
 assert.ok(resultValues(s,'safety').values.every(Number.isFinite));
});
test('progress remains indeterminate for older workers and completes only after result download',async()=>{
 const api=require('../src/lib/simulation/client.ts');const original=global.fetch;await api.setFeaTarget('server');const progress=[];
 global.fetch=async(url,init)=>{
  if(init?.method==='POST')return {ok:true,json:async()=>({id:'test'})};
  if(url.includes('result=1')){assert.notEqual(progress.at(-1).percent,100);return {ok:true,json:async()=>({results:{}})};}
  return {ok:true,json:async()=>({status:'completed'})};
 };
 try{await api.runFeaJob({},new AbortController().signal,()=>{},()=>{},p=>progress.push(p));assert.equal(progress[0].percent,null);assert.equal(progress.at(-1).percent,100);}
 finally{global.fetch=original;}
});
test('manual stress range clips colors, rejects invalid bounds, and preserves actual values',()=>{
 const {displayRange,validColorRange}=require('../src/lib/simulation/resultFields.ts');const s=study();
 assert.deepEqual(displayRange(s,'stress',{min:50,max:150}),[50,150]);
 assert.equal(fieldHue(-10,50,150,'stress'),.66);assert.equal(fieldHue(999,50,150,'stress'),0);
 assert.deepEqual(resultValues(s,'stress').values,[400,200,0]);
 for(const range of [{min:1,max:1},{min:5,max:1},{min:NaN,max:3},{min:0,max:Infinity}]){assert.equal(validColorRange(range),false);assert.deepEqual(displayRange(s,'stress',range),[0,400]);}
 assert.deepEqual(displayRange(s,'safety',{min:5,max:6}),[0,10]);
});
test('surface extrema respect body visibility and follow real, doubled and tripled displacement',()=>{
 const {surfaceExtrema}=require('../src/lib/simulation/resultFields.ts');
 const s=study();s.mesh={nodes:[[0,0,0],[3,0,0],[0,3,0],[10,0,0],[13,0,0],[10,3,0]],faces:[{bodyId:1,triangles:[[0,1,2]],elements:[0]},{bodyId:2,triangles:[[3,4,5]],elements:[1]}]};
 s.results.displacements=s.mesh.nodes.map(()=>[1,2,3]);
 for(const scale of [0,1,2,3]){
  const marks=surfaceExtrema(s,'stress',scale,1);assert.equal(marks.length,1);assert.equal(marks[0].value,400);
  assert.deepEqual(marks[0].position,[1+scale,1+2*scale,3*scale]);
 }
 const marks=surfaceExtrema(s,'stress',0);assert.deepEqual(marks.map(m=>m.value),[200,400]);
 assert.equal(surfaceExtrema(s,'stress',0,99).length,0);
});

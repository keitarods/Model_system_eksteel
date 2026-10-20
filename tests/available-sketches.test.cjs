const {test}=require('node:test');const assert=require('node:assert/strict');
const {availableSketches}=require('../src/lib/features/availableSketches.ts');
const sketch=id=>({id,type:'sketch',label:id,shapes:[],points:{},dimensions:[]});
test('new operations offer unused sketches, while an explicit selection can reuse its sketch',()=>{
 const features=[sketch('used'),sketch('free'),{id:'cut',type:'face',sketchReference:{sketchId:'used',profileShapeIds:[]}}];
 assert.deepEqual(availableSketches(features).map(f=>f.id),['free']);
 assert.deepEqual(availableSketches(features,'used').map(f=>f.id),['used','free']);
});
test('sweep paths, loft sections and sketches consumed by suppressed operations remain owned',()=>{
 const features=[sketch('path'),sketch('section'),sketch('used'),sketch('free'),{...sketch('hidden'),suppressed:true},
 {id:'sweep',type:'sweep',pathFeatureId:'path'}, {id:'loft',type:'loft',sectionIds:['section']},
 {id:'cut',type:'face',suppressed:true,sketchReference:{sketchId:'used',profileShapeIds:[]}}];
 assert.deepEqual(availableSketches(features).map(f=>f.id),['free']);
});

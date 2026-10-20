const {test}=require('node:test');const assert=require('node:assert/strict');
const React=require('react');const {renderToStaticMarkup}=require('react-dom/server');
const Module=require('node:module');const load=Module._load;
let zoom=2;const scales=[];
// Html's non-transform orthographic scaling contract: zoom * distanceFactor,
// or 1 when distanceFactor is absent. Capture what the real picker supplies.
Module._load=function(name,...args){
 if(name==='@react-three/drei')return {Html:({distanceFactor,children})=>{
  scales.push(distanceFactor===undefined?1:zoom*distanceFactor);return React.createElement('span',null,children);
 }};
 return load.call(this,name,...args);
};
const {PlanePicker3D}=require('../src/components/viewer/PlanePicker3D.tsx');Module._load=load;
test('choosing a sketch plane keeps all three HTML labels at screen size regardless of orthographic zoom',()=>{
 for(zoom of [.1,2,20]){
  scales.length=0;
  const html=renderToStaticMarkup(React.createElement(PlanePicker3D,{onPick:()=>{}}));
  assert.equal(scales.length,3);assert.deepEqual(scales,[1,1,1]);
  assert.match(html,/Plano XY/);assert.match(html,/Plano YZ/);
 }
});

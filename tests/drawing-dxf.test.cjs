const {test}=require('node:test');
const assert=require('node:assert/strict');
const {drawingSvgDxf}=require('../src/lib/drawing/svgDxf.ts');
test('sheet DXF transforms geometry into paper coordinates and skips hidden controls',()=>{
 const keys=['SVGGeometryElement','SVGTextElement','SVGPathElement','DOMPoint','getComputedStyle'];
 const saved=Object.fromEntries(keys.map(k=>[k,global[k]]));
 try {
  const matrix={a:2,b:0,c:0,d:2,e:10,f:20};
  global.DOMPoint=class {constructor(x,y){this.x=x;this.y=y;} matrixTransform(m){return {x:this.x*m.a+this.y*m.c+m.e,y:this.x*m.b+this.y*m.d+m.f};}};
  global.SVGGeometryElement=class {};
  global.SVGPathElement=class extends global.SVGGeometryElement {};
  global.SVGTextElement=class {};
  const svg={viewBox:{baseVal:{height:100}},getScreenCTM:()=>({inverse:()=>({multiply:m=>m})})};
  const line=Object.assign(new global.SVGGeometryElement(),{tagName:'line',parentElement:svg,closest:()=>null,getScreenCTM:()=>matrix,getTotalLength:()=>5,getPointAtLength:t=>({x:t,y:0})});
  const hidden=Object.assign(new global.SVGGeometryElement(),line,{hidden:true});
  global.getComputedStyle=el=>({display:'block',visibility:'visible',opacity:el.hidden?'0':'1',stroke:'black',strokeOpacity:'1',strokeDasharray:'none'});
  svg.querySelectorAll=()=>[line,hidden];
  const dxf=drawingSvgDxf(svg);
  assert.equal((dxf.match(/\nLINE\n/g)||[]).length,1);
  assert.match(dxf,/10\n10\.00000\n20\n80\.00000\n11\n20\.00000\n21\n80\.00000/);
  assert.match(dxf,/ENDSEC\n0\nEOF\n$/);
 } finally {for(const k of keys) {if(saved[k]===undefined)delete global[k];else global[k]=saved[k];}}
});

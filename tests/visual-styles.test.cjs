const {test}=require('node:test');
const assert=require('node:assert/strict');
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const {VISUAL_STYLES,visualStyleSettings,isVisualStyle,modelEdgePositions}=require('../src/lib/viewer/visualStyles.ts');
const {VisualStyleSelector,VisualSurfaceMaterial}=require('../src/components/viewer/VisualStyle.tsx');

test('visual style selector offers the same CAD modes and rejects invalid preferences',()=>{
 const html=renderToStaticMarkup(React.createElement(VisualStyleSelector,{value:'shadedEdges',onChange:()=>{}}));
 assert.equal((html.match(/<option/g)||[]).length,8);
 assert.match(html,/aria-label="Estilo visual"/);
 assert.match(html,/value="shadedEdges" selected/);
 for(const style of VISUAL_STYLES)assert.ok(isVisualStyle(style.id));
 for(const value of [null,{},'invalid','toString'])assert.equal(isVisualStyle(value),false);
 assert.equal(visualStyleSettings('wireframe').hidden,'solid');
 assert.equal(visualStyleSettings('wireframeHidden').hidden,'dashed');
 assert.equal(visualStyleSettings('wireframeVisible').hidden,'none');
});

test('shaded modes preserve picking depth and realistic appearance; FEA colors remain unlit',()=>{
 const appearance={color:'#aa3300',metalness:.9,roughness:.12,opacity:1};
 const realistic=VisualSurfaceMaterial({style:'realistic',appearance});
 assert.equal(realistic.props.metalness,.9);
 assert.equal(realistic.props.roughness,.12);
 const shaded=VisualSurfaceMaterial({style:'shaded',appearance});
 assert.equal(shaded.props.metalness,0);
 assert.equal(shaded.props.envMapIntensity,0);
 for(const style of ['wireframeHidden','wireframeVisible']){
  const material=VisualSurfaceMaterial({style});
  assert.equal(material.props.colorWrite,false);
  assert.equal(material.props.depthWrite,true);
 }
 assert.equal(VisualSurfaceMaterial({style:'wireframe'}).props.depthWrite,false);
 for(const {id,faces} of VISUAL_STYLES)if(faces){
  const material=VisualSurfaceMaterial({style:id,results:true,vertexColors:true});
  assert.equal(material.type,'meshBasicMaterial');
  assert.equal(material.props.vertexColors,true);
  assert.equal(material.props.toneMapped,false);
  assert.equal(material.props.colorWrite,true);
  assert.equal(material.props.depthWrite,true);
  assert.notEqual(material.key,VisualSurfaceMaterial({style:'wireframe'}).key);
 }
});

test('CAD outlines exclude triangulation diagonals and weld duplicated face vertices',()=>{
 const mesh={vertices:[0,0,0, 1,0,0, 1,1,0, 0,1,0],normals:[],triangles:[0,1,2, 0,2,3],faceGroups:[{start:0,count:6,faceId:1}]};
 const outline=modelEdgePositions(mesh);
 assert.equal(outline.length,4*6);
 for(let i=0;i<outline.length;i+=6)assert.ok(Math.hypot(...outline.slice(i,i+3).map((n,k)=>n-outline[i+3+k]))===1);
 const duplicated={...mesh,vertices:[...mesh.vertices,...mesh.vertices],triangles:[0,1,2,4,6,7]};
 assert.deepEqual(modelEdgePositions(duplicated),outline);
 const cadEdges={lines:[0,0,0, 2,0,0]};
 assert.equal(modelEdgePositions({...mesh,cadEdges}),cadEdges.lines);
});

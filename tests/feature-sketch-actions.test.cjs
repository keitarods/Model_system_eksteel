const {test}=require('node:test');
const assert=require('node:assert/strict');
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const {FeatureSketchActions}=require('../src/components/modelador/FeatureSketchActions.tsx');
const face={id:'face',type:'face',label:'Face 1',profile:{kind:'rect',x1:0,y1:0,x2:10,y2:20}};
const rule={id:'rule',type:'sheetMetal',label:'Chapa',thickness:2};
const sketch={id:'sk',type:'sketch',label:'Esboço da Face',visible:false};
const render=(feature,sketches=[],busy=false)=>renderToStaticMarkup(React.createElement(FeatureSketchActions,{feature,features:[rule,face],sketches,busy,onEdit:()=>{}}));
test('legacy Face without a stored sketch still offers recovery',()=>{
 const html=render(face);
 assert.match(html,/Editar esboço de Face 1/);assert.doesNotMatch(html,/ disabled=""/);
 assert.match(render(face,[],true),/ disabled=""/);
});
test('sketch is a child of its operation, with separate editing and visibility controls',()=>{
 const html=render(face,[sketch]);
 assert.match(html,/Esboços de Face 1/);assert.match(html,/Esboço da Face/);
 assert.match(html,/Mostrar Esboço da Face/);assert.match(html,/aria-pressed="false"/);
 assert.match(render(rule),/Editar esboço da Face base/);
});
test('child action opens the specific sketch; visibility does not start editing',()=>{
 let opened,shown;
 const tree=FeatureSketchActions({feature:face,features:[face],sketches:[sketch],busy:false,onEdit:()=>assert.fail('Not recovery'),onOpenSketch:s=>opened=s,onVisibility:s=>shown=s});
 const row=tree.props.children[0];
 row.props.children[0].props.onClick();assert.equal(opened,sketch);
 row.props.children[1].props.children[1].props.onClick();assert.equal(shown,sketch);
});
test('imported sheet explains missing source instead of promising an original sketch',()=>{
 const html=render({id:'step',type:'imported',format:'step',label:'Chapa STEP'});
 assert.match(html,/Corpo importado sem esboço de origem/);assert.match(html,/Reconstruir STEP/);assert.doesNotMatch(html,/Editar esboço/);
});

test('first Chapa item edits its base Face, not its thickness rule or a later cut',()=>{
 let opened;
 const element=FeatureSketchActions({feature:rule,features:[rule,{...face,id:'cut',cut:true},face],busy:false,onEdit:f=>opened=f});
 element.props.children.props.onClick();assert.equal(opened,face);
});

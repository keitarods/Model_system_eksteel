const {test}=require('node:test');const assert=require('node:assert/strict');
const React=require('react');const {renderToStaticMarkup}=require('react-dom/server');
const {FeatureExpandButton}=require('../src/components/modelador/FeatureExpandButton.tsx');
test('operation disclosure exposes plus/minus and toggles without invoking modeling actions',()=>{
 let expanded=false;
 const render=()=>FeatureExpandButton({label:'Face 2mm',expanded,controls:'face-children',onToggle:()=>{expanded=!expanded;}});
 let element=render();let html=renderToStaticMarkup(element);
 assert.match(html,/aria-expanded="false"/);assert.match(html,/>\+<\/button>/);assert.match(html,/aria-controls="face-children"/);
 element.props.onClick();element=render();html=renderToStaticMarkup(element);
 assert.match(html,/aria-expanded="true"/);assert.match(html,/>−<\/button>/);
 element.props.onClick();assert.equal(expanded,false);
});

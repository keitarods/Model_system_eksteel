const {test}=require('node:test');const assert=require('node:assert/strict');
const {SKETCH_TOOLS,SHORTCUT_TO_TOOL}=require('../src/lib/sketch/tools.ts');
test('sketch aliases stay unique and leave E for contextual extrusion',()=>{
 const bindings=SKETCH_TOOLS.filter(t=>t.shortcut).map(t=>t.shortcut.toLowerCase());
 assert.equal(new Set(bindings).size,bindings.length);
 assert.equal(SHORTCUT_TO_TOOL.e,undefined);
 assert.equal(SHORTCUT_TO_TOOL['shift+e'],'extend');
 assert.equal(SHORTCUT_TO_TOOL.t,'trim');assert.equal(SHORTCUT_TO_TOOL['shift+t'],'tangent');
 assert.equal(SHORTCUT_TO_TOOL.m,'measure');assert.equal(SHORTCUT_TO_TOOL.l,'line');
});

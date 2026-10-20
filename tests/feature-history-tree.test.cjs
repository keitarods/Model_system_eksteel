const {test}=require('node:test');const assert=require('node:assert/strict');
const {featureHistoryTree,showSketchOverlay}=require('../src/lib/features/historyTree.ts');
const plane={origin:[0,0,0],normal:[0,0,1],xDir:[1,0,0]};
const sketch=(id,x)=>({id,type:'sketch',label:id,plane,shapes:[{id:`${id}-c`,type:'circle',center:'p',radius:2}],points:{p:{id:'p',x,y:0}},dimensions:[]});
const operation=(id,x)=>({id,type:'face',label:id,plane,profile:{kind:'circle',cx:x,cy:0,r:2}});
test('Face and Cut own distinct sketch rows after loading legacy snapshots, without reordering the model',()=>{
 const features=[{id:'rule',type:'sheetMetal'},sketch('base-sketch',0),operation('base',0),{id:'bend',type:'flange'},sketch('cut-sketch',10),{...operation('cut',10),cut:true}];
 const saved=JSON.stringify(features);const tree=featureHistoryTree(features);
 assert.deepEqual(tree.map(n=>n.feature.id),['rule','base','bend','cut']);
 assert.deepEqual(tree[1].sketches.map(s=>s.id),['base-sketch']);assert.deepEqual(tree[3].sketches.map(s=>s.id),['cut-sketch']);
 assert.equal(JSON.stringify(features),saved);
});
test('shared sketches keep identity and unused sketches stay at the root',()=>{
 const s=sketch('s',0);const tree=featureHistoryTree([s,operation('a',0),operation('b',0),sketch('unused',30)]);
 assert.equal(tree[0].sketches[0],tree[1].sketches[0]);assert.equal(tree.at(-1).feature.id,'unused');
});
test('sweep and loft include their path and section sketches',()=>{
 const tree=featureHistoryTree([sketch('a',0),sketch('b',10),{id:'sweep',type:'sweep',pathFeatureId:'b',sketchReference:{sketchId:'a'}},{id:'loft',type:'loft',sectionIds:['a','b']}]);
 assert.deepEqual(tree.map(n=>n.sketches.map(s=>s.id)),[['a','b'],['a','b']]);
});
test('closing a sketch never shows the live buffer implicitly; explicit visibility and editing are separate',()=>{
 const s=sketch('s',0);
 assert.equal(showSketchOverlay(false,null,[s]),false);
 assert.equal(showSketchOverlay(false,'s',[s]),false);
 assert.equal(showSketchOverlay(false,'s',[{...s,visible:false}]),false);
 assert.equal(showSketchOverlay(false,'s',[{...s,visible:true}]),true);
 assert.equal(showSketchOverlay(false,'s',[{...s,visible:true,suppressed:true}]),false);
 assert.equal(showSketchOverlay(true,'s',[{...s,visible:false}]),true);
 assert.equal(showSketchOverlay(false,'removed',[s]),false);
});
test('creating an operation consumes and hides its sketch while keeping it editable',()=>{
 const {useFeatureStore:store}=require('../src/lib/features/store.ts');
 const s={...sketch('s',0),visible:true};store.setState({features:[s]});
 store.getState().addFeature(operation('face',0));
 const features=store.getState().features;
 assert.equal(features[0].visible,false);assert.equal(features[1].sketchReference.sketchId,'s');
 assert.equal(featureHistoryTree(features)[0].sketches[0].id,'s');
});
test('editing the Face sketch rolls back its solid and later bends only in the displayed history',()=>{
 const {sketchEditingHistory}=require('../src/lib/features/historyTree.ts');
 const features=[{id:'rule',type:'sheetMetal'},sketch('s',0),operation('face',0),{id:'bend',type:'flange'}];
 const before=JSON.stringify(features);
 assert.deepEqual(sketchEditingHistory(features,true,'s').map(f=>f.id),['rule']);
 assert.equal(sketchEditingHistory(features,false,'s'),features);
 assert.equal(sketchEditingHistory(features,true,null),features);
 assert.equal(JSON.stringify(features),before);
});
test('Chapa base shortcut stays within its body and sheet rule, ignoring cuts',()=>{
 const {sheetBaseFace}=require('../src/lib/features/historyTree.ts');
 const rule={id:'rule',type:'sheetMetal'};
 const foreign={...operation('foreign',0),bodyGroupId:'another'};
 const cut={...operation('cut',0),cut:true};const base=operation('base',10);
 assert.equal(sheetBaseFace([rule,foreign,cut,base],'rule'),base);
 assert.equal(sheetBaseFace([rule,foreign,cut,{id:'next',type:'sheetMetal'},base],'rule'),undefined);
});

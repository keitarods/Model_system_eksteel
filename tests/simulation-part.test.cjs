const {test}=require('node:test');const assert=require('node:assert/strict');
const {serializeProject,parseProject}=require('../src/lib/project/nativeFormat.ts');
const {emptyStudy}=require('../src/lib/simulation/types.ts');
const {usePartStudiesStore}=require('../src/lib/simulation/partStudyStore.ts');
const {withPartProperties}=require('../src/lib/assembly/componentMaterial.ts');
function document(){const study={...emptyStudy(),step:'ISO-10303-21;',sourcePart:{documentId:'part-a',studyId:'study-a'}};return {id:'part-a',studies:[{id:'study-a',sourceFeatures:'[]',study}]};}
test('native piece preserves multiple studies and legacy files remain compatible',()=>{
 const doc=document();doc.studies.push({...doc.studies[0],id:'study-b',study:{...doc.studies[0].study,name:'Outro estudo',sourcePart:{documentId:doc.id,studyId:'study-b'}}});
 const restored=parseProject(serializeProject([],[],undefined,doc));assert.deepEqual(restored.simulations,doc);
 assert.equal(parseProject(serializeProject([])).simulations,undefined);
 assert.deepEqual(parseProject(withPartProperties(serializeProject([],[],undefined,doc),restored.properties)).simulations,doc);
});
test('record updates only the linked piece and preserves geometry snapshot',()=>{
 const doc=document();usePartStudiesStore.getState().load(doc);
 const study={...doc.studies[0].study,name:'Atualizado'};
 assert.equal(usePartStudiesStore.getState().record(study),true);
 assert.equal(usePartStudiesStore.getState().document.studies.length,1);
 assert.equal(usePartStudiesStore.getState().document.studies[0].study.name,'Atualizado');
 assert.equal(usePartStudiesStore.getState().record({...study,sourcePart:{documentId:'other',studyId:'study-a'}}),false);
 usePartStudiesStore.getState().load();assert.equal(usePartStudiesStore.getState().record(study),false);
 assert.equal(usePartStudiesStore.getState().document.studies.length,0);
});
test('malformed embedded studies are rejected instead of silently discarded',()=>{
 const doc=document();doc.studies[0].study.size=-1;assert.throws(()=>parseProject(serializeProject([],[],undefined,doc)),/inválida/);
 const duplicated=document();duplicated.studies.push(duplicated.studies[0]);assert.throws(()=>parseProject(serializeProject([],[],undefined,duplicated)),/inválido/);
});
test('solved native piece restores mesh, boundary conditions and complete heatmap results',()=>{
 const doc=document(),s=doc.studies[0].study;
 s.elementType='C3D4';s.mesh={nodes:[[0,0,0],[1,0,0],[0,1,0],[0,0,1]],tetrahedra:[[0,1,2,3]],faces:[{id:1,triangles:[[0,2,1]],elements:[0],area:.5,center:[.33,.33,0]}],quality:{minimum:.8,mean:.8},volume:1/6,size:1,refinements:[],elementType:'C3D4'};
 s.supports=[{id:'support',faceIds:[1],axes:[true,true,true]}];s.loads=[{id:'force',kind:'force',faceIds:[1],direction:'normal',magnitude:100,inverted:true,vector:[0,0,0],pressure:0}];
 s.results={displacements:Array.from({length:4},()=>[0,0,.01]),displacementMagnitude:[.01,.01,.01,.01],nodalVonMises:[10,10,10,10],elementVonMises:[10],elementStress:[[10,0,0,0,0,0]],elementStrain:[[.001,0,0,0,0,0]],reactions:Array.from({length:4},()=>[0,0,0]),summary:{maxDisplacement:.01,maxVonMises:10,minSafetyFactor:25,reaction:[0,0,0],appliedForce:[0,0,0],balanceError:0,freeResidualRelative:0},solver:'CalculiX',elementType:'C3D4'};
 const loaded=parseProject(serializeProject([],[],undefined,doc));
 assert.deepEqual(loaded.simulations.studies[0].study,s);
 usePartStudiesStore.getState().load(loaded.simulations);
 assert.deepEqual(usePartStudiesStore.getState().document.studies[0].study.results,s.results);
});

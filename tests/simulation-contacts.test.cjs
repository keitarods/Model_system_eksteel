const {test}=require('node:test');const assert=require('node:assert/strict');
const {suggestBondedPairs}=require('../src/lib/simulation/contacts.ts');
const {emptyStudy}=require('../src/lib/simulation/types.ts');
const {parseStudy,serializeStudy,validateResults}=require('../src/lib/simulation/format.ts');
const {verifyFaceReferences}=require('../src/lib/simulation/convergence.ts');
const face={id:1,bodyId:1,normal:[1,0,0],area:1,center:[0,0,0],triangles:[[0,1,2]],elements:[0]};
const mesh={nodes:[[0,0,0],[1,0,0],[0,1,0],[0,0,1]],tetrahedra:[[0,1,2,3]],faces:[face,{...face,id:2,bodyId:2,normal:[-1,0,0]}],quality:{minimum:1,mean:1},size:1,volume:1/6,elementType:'C3D4',refinements:[]};
const contact={id:'pair',kind:'bonded',masterFaceId:1,slaveFaceId:2};
test('contact candidates require opposite normals, independent bodies and coincident faces',()=>{
 assert.deepEqual(suggestBondedPairs(mesh),[[2,1]]);
 for(const patch of [{bodyId:1},{normal:[1,0,0]},{center:[.01,0,0]},{area:2}])assert.deepEqual(suggestBondedPairs({...mesh,faces:[face,{...mesh.faces[1],...patch}]}),[]);
});
test('contacts persist and invalid references and unsupported types are rejected',()=>{
 const study={...emptyStudy(),elementType:'C3D4',mesh,contacts:[contact]};
 assert.deepEqual(parseStudy(serializeStudy(study)),study);
 for(const patch of [{kind:'frictionless'},{masterFaceId:2},{slaveFaceId:99}])assert.throws(()=>parseStudy(serializeStudy({...study,contacts:[{...contact,...patch}]})),/Contat|contat/i);
 assert.throws(()=>parseStudy(serializeStudy({...study,contacts:[contact,contact]})),/Contatos/);
});
test('remeshing verifies contact face references even without loads on those faces',()=>{
 const study={...emptyStudy(),contacts:[contact]};verifyFaceReferences(mesh,mesh,study);
 assert.throws(()=>verifyFaceReferences(mesh,{...mesh,faces:[face]},study),/faces/);
});
test('old solver cannot silently omit requested contacts',()=>{
 const result={elementType:'C3D4',displacements:mesh.nodes.map(()=>[0,0,0]),displacementMagnitude:[0,0,0,0],nodalVonMises:[0,0,0,0],elementStress:[[0,0,0,0,0,0]],elementStrain:[[0,0,0,0,0,0]],elementVonMises:[0],reactions:mesh.nodes.map(()=>[0,0,0]),summary:{maxDisplacement:0,maxVonMises:0,minSafetyFactor:null,balanceError:0,freeResidualRelative:0,reaction:[0,0,0],appliedForce:[0,0,0]}};
 assert.throws(()=>validateResults(result,mesh,[contact]),/contatos solicitados/);
 const withContacts={...result,contacts:[{id:'pair',bondedNodes:3,maxInitialGap:0,maxRelativeDisplacement:0,slaveForce:[1,0,0],masterForce:[-1,0,0]}],nodalContactForces:mesh.nodes.map(()=>[0,0,0])};
 validateResults(withContacts,mesh,[contact]);
 assert.throws(()=>validateResults({...withContacts,contacts:[{...withContacts.contacts[0],bondedNodes:NaN}]},mesh,[contact]),/contato/);
});
test('frictionless parameters and complete incremental results survive persistence',()=>{
 const pair={...contact,kind:'frictionless',normalStiffness:1e6,searchDistance:.1};
 const study={...emptyStudy(),elementType:'C3D4',mesh,contacts:[pair]};
 assert.deepEqual(parseStudy(serializeStudy(study)),study);
 for(const patch of [{normalStiffness:0},{normalStiffness:1e10},{searchDistance:-1},{searchDistance:11}])assert.throws(()=>parseStudy(serializeStudy({...study,contacts:[{...pair,...patch}]})),/Contatos/);
 const mixed={...study,contacts:[pair,{...contact,id:'second'}]};
 assert.deepEqual(parseStudy(serializeStudy(mixed)),mixed);
 const result={elementType:'C3D4',displacements:mesh.nodes.map(()=>[0,0,0]),displacementMagnitude:[0,0,0,0],nodalVonMises:[0,0,0,0],elementStress:[[0,0,0,0,0,0]],elementStrain:[[0,0,0,0,0,0]],elementVonMises:[0],reactions:mesh.nodes.map(()=>[0,0,0]),summary:{maxDisplacement:0,maxVonMises:0,minSafetyFactor:null,balanceError:0,freeResidualRelative:0,reaction:[0,0,0],appliedForce:[0,0,0]},contacts:[{id:'pair',kind:'frictionless',bondedNodes:0,contactPoints:3,activePoints:0,maxInitialGap:0,maxRelativeDisplacement:0,maxOpening:0,maxPenetration:0,maxPressure:0,contactEnergy:0,maxTangentialSlip:0,slaveForce:[0,0,0],masterForce:[0,0,0]}],nodalContactForces:mesh.nodes.map(()=>[0,0,0]),nonlinearHistory:[{loadFactor:.5,iterations:2,activePoints:0},{loadFactor:1,iterations:1,activePoints:0}]};
 assert.deepEqual(parseStudy(serializeStudy({...study,results:result})).results,result);
 const bondedResult={id:'second',kind:'bonded',bondedNodes:3,maxInitialGap:0,maxRelativeDisplacement:0,slaveForce:[0,0,0],masterForce:[0,0,0]};
 const mixedResult={...result,contacts:[result.contacts[0],bondedResult]};
 assert.deepEqual(parseStudy(serializeStudy({...mixed,results:mixedResult})).results,mixedResult);
 assert.throws(()=>validateResults(result,mesh,mixed.contacts),/contatos solicitados/);
 assert.throws(()=>validateResults({...mixedResult,nonlinearHistory:[]},mesh,mixed.contacts),/carga total/);

 for(const history of [undefined,[],result.nonlinearHistory.slice(0,1),[...result.nonlinearHistory].reverse()])assert.throws(()=>validateResults({...result,nonlinearHistory:history},mesh,[pair]),/carga total|incremental/);
 assert.throws(()=>validateResults({...result,contacts:[{...result.contacts[0],activePoints:4}]},mesh,[pair]),/unilateral/);
 assert.throws(()=>validateResults(result,mesh,[contact]),/contatos solicitados/);
});

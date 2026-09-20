const { test } = require('node:test');
const assert = require('node:assert/strict');
const { BoxGeometry } = require('three');
const { importBodies } = require('../src/lib/replicad/exchangeImport.ts');
const { rebuildModel } = require('../src/lib/replicad/build-model.ts');
const { serializeProject, parseProject } = require('../src/lib/project/nativeFormat.ts');
const { useFeatureStore: store } = require('../src/lib/features/store.ts');
const { undoModel, redoModel, useUndoStore: history } = require('../src/lib/history/store.ts');
let ordinal = 0;
const id = () => `converted-${++ordinal}`;

function makeGLB({ open = false, external = false, compressed = false, scale = [1,1,1], second = false, split = false } = {}) {
  const geometry = new BoxGeometry(.01, .02, .03).toNonIndexed();
  const coords = geometry.getAttribute('position').array;
  const count = coords.length - (open ? 9 : 0);
  const bin = new Uint8Array(coords.buffer, 0, count * 4);
  const json = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }],
    nodes: [{ name: 'Conjunto', translation: [.1, .2, .3], children: second ? [1,2] : [1] }, { name: 'Bloco', mesh: 0, scale }, ...(second ? [{ name: 'Outro', mesh: 0, translation: [.04,0,0] }] : [])],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: count / 3, type: 'VEC3', min: [-.005,-.01,-.015], max: [.005,.01,.015] }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bin.length }],
    buffers: [{ byteLength: bin.length, ...(external ? { uri: 'https://example.com/private.bin' } : {}) }],
    ...(compressed ? { extensionsRequired: ['KHR_draco_mesh_compression'] } : {}),
  };
  if (split) {
    json.accessors[0].count = count / 6;
    json.accessors.push({ ...json.accessors[0], byteOffset: count * 2 });
    json.meshes[0].primitives.push({attributes:{POSITION:1}});
  }
  const encoded = Buffer.from(JSON.stringify(json)), length = Math.ceil(encoded.length / 4) * 4;
  const buffer = Buffer.alloc(28 + length + bin.length, 32);
  buffer.writeUInt32LE(0x46546c67,0); buffer.writeUInt32LE(2,4); buffer.writeUInt32LE(buffer.length,8);
  buffer.writeUInt32LE(length,12); buffer.writeUInt32LE(0x4e4f534a,16); encoded.copy(buffer,20);
  buffer.writeUInt32LE(bin.length,20+length); buffer.writeUInt32LE(0x004e4942,24+length); buffer.set(bin,28+length);
  geometry.dispose(); return new Blob([buffer]);
}

test('GLB converts transformed and mirrored nodes to independent native bodies in mm, with history and downstream cuts', async () => {
  await require('./kernel.cjs')();
  const r = require('replicad');
  const result = await importBodies(makeGLB({ second: true, scale: [-1,1,1] }), 'assembly.glb', id);
  assert.equal(result.features.length, 2);
  assert.equal(result.features[0].source.nodePath, 'Conjunto / Bloco');
  const saved = parseProject(serializeProject(result.features)).features;
  let model = rebuildModel(saved);
  assert.ok(Math.abs(r.measureVolume(model)-12000)<.01);
  const bounds = model.boundingBox.bounds;
  assert.ok(Math.abs(bounds[0][0]-95)<.001);
  assert.ok(Math.abs(bounds[0][1]+315)<.001);
  assert.ok(Math.abs(bounds[0][2]-190)<.001);
  model.delete();
  const cut = { id:'cut',type:'extrude',label:'Furo',profile:{kind:'circle',cx:100,cy:-300,r:2},plane:{origin:[0,0,190],normal:[0,0,1],xDir:[1,0,0]},depth:20,cut:true };
  model = rebuildModel([...saved, cut]);
  assert.ok(Math.abs(r.measureVolume(model)-(12000-80*Math.PI))<.02); model.delete();
  store.getState().clear(); await new Promise(queueMicrotask); history.setState({past:[],future:[]});
  store.setState({features:saved}); undoModel(); assert.equal(store.getState().features.length,0);
  redoModel(); assert.equal(store.getState().features.length,2);
  const millimetres = await importBodies(makeGLB(), 'small.glb', id, {glbScale:1});
  model = rebuildModel(millimetres.features); assert.ok(Math.abs(r.measureVolume(model)-.000006)<1e-10); model.delete();
});

test('conversion rejects open GLB, external buffers, compression and Inventor originals without mutating the document', async () => {
  await require('./kernel.cjs')();
  const before = store.getState().features;
  await assert.rejects(() => importBodies(makeGLB({open:true}), 'open.glb', id), /inválido|aberto|converter/);
  await assert.rejects(() => importBodies(makeGLB({external:true}), 'external.glb', id), /externos/);
  await assert.rejects(() => importBodies(makeGLB({compressed:true}), 'compressed.glb', id), /compressão/);
  await assert.rejects(() => importBodies(new Blob(['x']), 'original.iam', id), /Inventor/);
  await assert.rejects(() => importBodies(new Blob(['x']), 'broken.glb', id), /incompleto/);
  assert.equal(store.getState().features, before);
});

test('multi-body STEP converts each solid and preserves touching bodies without union on rebuild', async () => {
  await require('./kernel.cjs')(); const r = require('replicad');
  const compound = r.makeCompound([r.makeBox([0,0,0],[10,20,30]),r.makeBox([10,0,0],[20,20,30])]);
  try {
    const result = await importBodies(compound.blobSTEP(), 'bodies.step', id);
    assert.equal(result.features.length,2);
    const model = rebuildModel(parseProject(serializeProject(result.features)).features);
    const solids = Array.from(r.iterTopo(model.wrapped,'solid'));
    assert.equal(solids.length,2); solids.forEach(s=>s.delete());
    assert.ok(Math.abs(r.measureVolume(model)-12000)<.001); model.delete();
  } finally {compound.delete();}
});


test('GLB material primitives of the same node are reunited before closed-solid validation', async () => {
  await require('./kernel.cjs')(); const r = require('replicad');
  const result = await importBodies(makeGLB({split:true}), 'materials.glb', id);
  assert.equal(result.features.length,1);
  const model = rebuildModel(result.features);
  assert.ok(Math.abs(r.measureVolume(model)-6000)<.01); model.delete();
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { exportSolidStl } = require('../src/lib/replicad/stlExport.ts');

test('STL binary round-trip contains twelve valid box facets in millimetres', async () => {
  const oc = await require('./kernel.cjs')();
  const r = require('replicad'); r.setOC(oc);
  const solid = r.makeBox([0,0,0],[10,20,30]);
  try {
    const blob=exportSolidStl(solid);
    const data=new DataView(await blob.arrayBuffer());
    const count=data.getUint32(80,true);
    assert.equal(count,12); assert.equal(data.byteLength,84+count*50);
    const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
    for(let i=0;i<count;i++) {
      const base=84+i*50;
      const normal=[0,1,2].map(k=>data.getFloat32(base+k*4,true));
      assert.ok(Math.abs(Math.hypot(...normal)-1)<1e-6);
      for(let j=0;j<3;j++) for(let k=0;k<3;k++) {
        const value=data.getFloat32(base+12+j*12+k*4,true);
        assert.ok(Number.isFinite(value)); min[k]=Math.min(min[k],value);max[k]=Math.max(max[k],value);
      }
    }
    assert.deepEqual(min,[0,0,0]); assert.deepEqual(max,[10,20,30]);
    // Export must leave the BREP usable for a subsequent exchange operation.
    assert.ok(solid.blobSTEP().size>0);
  } finally {solid.delete();}
});

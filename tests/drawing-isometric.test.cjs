const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildDrawingView } = require('../src/lib/replicad/technicalDrawing.ts');

test('isometric projection shows three axes and stays invariant when the part moves', async () => {
  await require('./kernel.cjs')();
  const { drawRectangle } = require('replicad');
  const solid = drawRectangle(60, 40).sketchOnPlane('XY').extrude(20);
  try {
    const original = buildDrawingView(solid, 'iso', false);
    // Equal foreshortening of all three axes in a true isometric projection.
    assert.ok(Math.abs(original.box.width - 100 / Math.sqrt(2)) < 0.01);
    assert.ok(Math.abs(original.box.height - 140 / Math.sqrt(6)) < 0.01);
    const slopes = new Set(original.visibleLineEdges.map(e => {
      const dx = Math.abs(e.x2 - e.x1), dy = Math.abs(e.y2 - e.y1);
      return dx < 1e-5 ? 'vertical' : (dy / dx).toFixed(3);
    }));
    assert.ok(slopes.has('vertical'));
    assert.ok(slopes.has('0.577'));
    const moved = solid.clone().translate([200, -100, 1000]);
    try {
      const view = buildDrawingView(moved, 'iso', false);
      assert.ok(Math.abs(view.box.width - original.box.width) < 0.01);
      assert.ok(Math.abs(view.box.height - original.box.height) < 0.01);
      assert.equal(view.visibleLineEdges.length, original.visibleLineEdges.length);
    } finally { moved.delete(); }
  } finally { solid.delete(); }
});

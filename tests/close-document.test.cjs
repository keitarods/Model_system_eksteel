const { test } = require('node:test');
const assert = require('node:assert/strict');
const { useSketchStore } = require('../src/lib/sketch/store.ts');
const { resetModelHistory, undoModel, useUndoStore } = require('../src/lib/history/store.ts');

test('closing discards pending history and subsequent undo cannot restore the closed document', async () => {
  useSketchStore.setState({ points: { old: { x: 1, y: 2 } } });
  await Promise.resolve();
  useSketchStore.getState().clear();
  const emptyPoints = useSketchStore.getState().points;
  resetModelHistory();
  await Promise.resolve();
  assert.deepEqual(useUndoStore.getState(), { past: [], future: [] });
  undoModel();
  assert.deepEqual(useSketchStore.getState().points, emptyPoints);
  useSketchStore.setState({ points: { fresh: { x: 3, y: 4 } } });
  undoModel();
  assert.deepEqual(useSketchStore.getState().points, emptyPoints);
});

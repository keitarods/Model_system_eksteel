const { test } = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { renderToString } = require('react-dom/server');
const { ModeladorClient } = require('../src/components/modelador/ModeladorClient.tsx');
const { useFeatureStore } = require('../src/lib/features/store.ts');

// The server must never emit mutable CAD controls for hydration to reconcile.
// Browser stores can contain a document after navigating between part/assembly.
test('modelador SSR emits only a stable loading boundary, independent of the CAD document', () => {
  const original = useFeatureStore.getState().features;
  const render = () => renderToString(React.createElement(ModeladorClient, { userEmail: '' }));
  try {
    useFeatureStore.setState({ features: [] });
    const empty = render();
    useFeatureStore.setState({ features: [{ id: 'test', type: 'imported', label: 'Part', format: 'step', brep: 'not evaluated on server' }] });
    const populated = render();
    assert.equal(populated, empty);
    assert.match(empty, /role="status"/);
    assert.match(empty, /aria-busy="true"/);
    assert.doesNotMatch(empty, /<button|<canvas|disabled=/);
  } finally { useFeatureStore.setState({ features: original }); }
});

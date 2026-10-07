const { test } = require('node:test');
const assert = require('node:assert/strict');
const { selectPdfSheets } = require('../src/lib/drawing/pdfSheets.ts');
const sheets = [{ id: 'a', size: 'A4' }, { id: 'b', size: 'A3' }, { id: 'c', size: 'A2' }];
test('PDF selection exports current, all or selected sheets in document order', () => {
  assert.deepEqual(selectPdfSheets(sheets, 'b', 'current', []), [sheets[1]]);
  assert.deepEqual(selectPdfSheets(sheets, 'b', 'all', []), sheets);
  assert.deepEqual(selectPdfSheets(sheets, 'b', 'selected', ['c', 'a', 'a', 'deleted']), [sheets[0], sheets[2]]);
  assert.equal(selectPdfSheets(sheets, 'b', 'current', [])[0], sheets[1]);
});
test('PDF rejects empty selections and removed sheets instead of producing a blank page', () => {
  for (const [pages, current, scope, ids] of [[[], undefined, 'all', []], [sheets, 'deleted', 'current', []], [sheets, 'a', 'selected', []], [sheets, 'a', 'selected', ['deleted']]]) {
    assert.throws(() => selectPdfSheets(pages, current, scope, ids), /Selecione pelo menos uma folha/);
  }
});

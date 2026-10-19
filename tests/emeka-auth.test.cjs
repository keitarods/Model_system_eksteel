const { test } = require('node:test');
const assert = require('node:assert/strict');
const { authRedirect } = require('../src/lib/supabase/authRedirect.ts');
test('auth callbacks allow only tool portal and password routes', () => {
  for (const destination of [null, '//evil.example', '/\\evil.example', 'https://evil.example', '/modelador']) {
    assert.equal(authRedirect(destination, null), '/ferramentas');
  }
  assert.equal(authRedirect('/reset-password', null), '/reset-password');
  assert.equal(authRedirect(null, 'recovery'), '/reset-password');
  assert.equal(authRedirect(null, 'invite'), '/reset-password');
});

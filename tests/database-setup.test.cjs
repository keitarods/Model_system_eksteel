const { test: nodeTest } = require('node:test');
const { existsSync } = require('node:fs');
const { join } = require('node:path');
// Private provisioning scripts are intentionally distributed outside this repository.
const scriptsAvailable = ['database/postgres.sql', 'database/mysql.sql', 'database/mssql.sql',
  'database/postgres-current.sql', 'database/mysql-current.sql', 'database/mssql-current.sql',
  'supabase/migrations/202609180001_cad_project_storage.sql',
  'supabase/migrations/202609190002_cad_current.sql'].every(p => existsSync(join(__dirname, '..', p)));
const test = (name, fn) => nodeTest(name, { skip: scriptsAvailable ? false : 'Private provisioning scripts not installed' }, fn);
const assert = require('node:assert/strict');
const { prepareSqlDatabase, prepareSupabaseDatabase } = require('../src/lib/project/server/prepareDatabase.ts');

test('SQL setup creates missing bundled tables and repeated setup never replaces existing data', async () => {
  for (const kind of ['postgres','mysql','mssql']) {
    const tables = new Set(['eksteel_cad_folders']);
    const writes = [];
    const driver = { async query(sql) {
      const table = /(?:FROM|TABLE) (eksteel_cad_\w+)/.exec(sql)?.[1];
      if (sql.startsWith('SELECT')) {
        if (!tables.has(table)) throw Object.assign(new Error('missing'), { code: kind === 'postgres' ? '42P01' : 'ER_NO_SUCH_TABLE', number: 208 });
        return [];
      }
      assert.match(sql, /^CREATE TABLE eksteel_cad_/);
      assert.ok(!tables.has(table));
      writes.push(sql); tables.add(table); return [];
    } };
    await prepareSqlDatabase(driver, kind);
    assert.equal(writes.length, 2);
    await prepareSqlDatabase(driver, kind);
    assert.equal(writes.length, 2);
    assert.equal(tables.size, 3);
  }
});
test('SQL setup stops on denied reads or incompatible columns without attempting replacement', async () => {
  let calls = 0;
  await assert.rejects(prepareSqlDatabase({ async query() { calls++; throw { code: '42501', message: 'secret' }; } }, 'postgres'), /Preparação: estrutura existente/);
  assert.equal(calls, 1);
});
test('SQL setup explains denied CREATE without leaking driver details', async () => {
  await assert.rejects(prepareSqlDatabase({ async query(sql) {
    if (sql.startsWith('SELECT')) throw { code: '42P01' };
    throw new Error('password=secret');
  } }, 'postgres'), /permissão CREATE TABLE/);
});
test('Supabase setup is transactional, reentrant and preserves existing table data', async () => {
  const queries = [];
  const driver = { async query(sql) { queries.push(sql); return []; } };
  await prepareSupabaseDatabase(driver);
  await prepareSupabaseDatabase(driver);
  assert.equal(queries.filter(q => q === 'BEGIN').length, 2);
  assert.equal(queries.filter(q => q === 'COMMIT').length, 2);
  assert.ok(queries.some(q => /create table if not exists public.eksteel_cad_current/i.test(q)));
  assert.ok(queries.some(q => /enable row level security/i.test(q)));
  assert.ok(queries.some(q => /NOTIFY pgrst/.test(q)));
  assert.ok(!queries.some(q => /DROP TABLE|TRUNCATE|DELETE FROM/i.test(q)));
});
test('Supabase setup rolls back failures and refuses unexpected policies', async () => {
  const queries = [];
  await assert.rejects(prepareSupabaseDatabase({ async query(sql) {
    queries.push(sql);
    if (sql.includes('pg_policies')) return [{ policyname: 'custom' }];
    return [];
  } }), /políticas personalizadas/);
  assert.equal(queries.at(-1), 'ROLLBACK');
  assert.ok(!queries.some(q => /DROP POLICY/.test(q)));
  const broken = [];
  await assert.rejects(prepareSupabaseDatabase({ async query(sql) {
    broken.push(sql);
    if (sql.includes('auth.users')) throw new Error('secret');
    return [];
  } }), /Não foi possível confirmar/);
  assert.equal(broken.at(-1), 'ROLLBACK');
});

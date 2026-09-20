const { test } = require('node:test');
const assert = require('node:assert/strict');
const { databaseCredentials } = require('../src/lib/project/databaseConfig.ts');
const { databaseProjectAction } = require('../src/lib/project/server/databaseProjects.ts');
const { addDatabaseSession, getDatabaseSession, removeDatabaseSession } = require('../src/lib/project/server/databaseSessions.ts');
const { serializeProject } = require('../src/lib/project/nativeFormat.ts');
const config = { kind: 'postgres', host: 'db.example.com', port: 5432, database: 'cad', username: 'cad', password: 'secret' };
test('SQL destinations fail closed and credentials cannot inject connection options', () => {
  assert.throws(() => databaseCredentials(config, ''), /Destino não autorizado/);
  assert.deepEqual(databaseCredentials(config, 'db.example.com:5432'), config);
  for (const change of [{ port: 22 }, { host: '127.0.0.1' }, { host: 'db.example.com?ssl=false' }, { port: '5432' }, { kind: 'unknown' }]) assert.throws(() => databaseCredentials({ ...config, ...change }, 'db.example.com:5432'));
});
test('opaque SQL sessions are bound to authenticated owner and revoked on disconnect', () => {
  const token = addDatabaseSession('owner-a', config);
  assert.equal(token.length, 64);
  assert.throws(() => getDatabaseSession(token, 'owner-b'), /expirada/);
  assert.throws(() => removeDatabaseSession(token, 'owner-b'), /expirada/);
  assert.equal(getDatabaseSession(token, 'owner-a').credentials.host, config.host);
  removeDatabaseSession(token, 'owner-a');
  assert.throws(() => getDatabaseSession(token, 'owner-a'), /expirada/);
});
test('all SQL engines parameterize owner and names; saves insert immutable native versions', async () => {
  for (const kind of ['postgres', 'mysql', 'mssql']) {
    const calls = []; const driver = { query: async (sql, values) => { calls.push({ sql, values }); return []; } };
    await databaseProjectAction(driver, kind, 'authenticated-user', { action: 'folders', owner: 'attacker', offset: 100 });
    await databaseProjectAction(driver, kind, 'authenticated-user', { action: 'createFolder', folder: 'Engenharia' });
    const json = serializeProject([]);
    const version = await databaseProjectAction(driver, kind, 'authenticated-user', { action: 'save', folder: 'Engenharia', project: 'Peça', json });
    assert.match(version, /\.eks3d$/);
    assert.ok(calls.every(c => c.values[0] === 'authenticated-user' && !c.sql.includes('authenticated-user')));
    assert.ok(calls[2].sql.startsWith('INSERT'));
    assert.equal(calls[2].values[4], json);
    assert.match(calls[0].sql, kind === 'mssql' ? /OFFSET 100 ROWS FETCH NEXT 100/ : /LIMIT 100 OFFSET 100/);
    await assert.rejects(databaseProjectAction(driver, kind, 'u', { action: 'folders', offset: '0; DROP TABLE x' }), /Página inválida/);
  }
});
test('missing/corrupt versions and unsupported commands fail without replacing a document', async () => {
  const driver = { query: async () => [] };
  await assert.rejects(databaseProjectAction(driver, 'postgres', 'u', { action: 'delete' }), /não suportada/);
  await assert.rejects(databaseProjectAction(driver, 'postgres', 'u', { action: 'save', folder: 'F', project: 'P', json: '{}' }));
  await assert.rejects(databaseProjectAction(driver, 'postgres', 'u', { action: 'open', folder: 'F', project: 'P', version: '2026-09-18T15-00-00.000Z_00000000-0000-4000-8000-000000000001.eks3d' }), /não encontrada/);
});

test('SQL driver contracts enable certificate verification and bind values separately', async () => {
  const Module = require('node:module');
  const original = Module._load;
  const { openDatabase } = require('../src/lib/project/server/databaseDriver.ts');
  const calls = [];
  class Pg {
    constructor(options) { calls.push({ kind: 'postgres', options }); }
    on() {}
    async connect() {}
    async end() {}
    async query(sql, values) { calls.push({ sql, values }); return sql.startsWith('UPDATE') ? { command: 'UPDATE', rowCount: 1, rows: [] } : { rows: [] }; }
  }
  class Pool {
    constructor(options) { calls.push({ kind: 'mssql', options }); }
    on() {}
    async connect() {}
    async close() {}
    request() {
      const values = [];
      return { input(name, type, value) { values.push(value); }, async query(sql) { calls.push({ sql, values }); return sql.startsWith('UPDATE') ? { rowsAffected: [1] } : { recordset: [] }; } };
    }
  }
  Module._load = function(id, ...args) {
    if (id === 'pg') return { Client: Pg };
    if (id === 'mysql2/promise') return { async createConnection(options) {
      calls.push({ kind: 'mysql', options });
      return { on() {}, async end() {}, async execute(options, values) { calls.push({ sql: options.sql, values }); return options.sql.startsWith('UPDATE') ? [{ affectedRows: 1 }, []] : [[], []]; } };
    } };
    if (id === 'mssql') return { ConnectionPool: Pool, NVarChar: () => 'nvarchar', MAX: -1 };
    return original.call(this, id, ...args);
  };
  try {
    const attack = "x'; DROP TABLE eksteel_cad_folders; --";
    for (const kind of ['postgres', 'mysql', 'mssql']) {
      const driver = await openDatabase({ ...config, kind });
      await driver.query('SELECT name FROM eksteel_cad_folders WHERE owner_id = ? AND name = ?', ['owner', attack]);
      const changed = await driver.query('UPDATE eksteel_cad_current SET revision_token = ? WHERE owner_id = ?', ['owner', attack]);
      assert.equal(changed[0].affected, 1);
      await driver.close();
    }
    for (const c of calls.filter(c => c.sql)) {
      assert.ok(!c.sql.includes(attack)); assert.equal(c.values[1], attack);
    }
    for (const c of calls.filter(c => c.kind)) {
      if (c.kind === 'mssql') { assert.equal(c.options.options.encrypt, true); assert.equal(c.options.options.trustServerCertificate, false); }
      else assert.equal(c.options.ssl.rejectUnauthorized, true);
    }
    assert.match(calls.find(c => c.sql)?.sql, /\$1.*\$2/);
    assert.match(calls[calls.length - 1].sql, /@p1.*@p2/);
  } finally { Module._load = original; }
});


test('SQL current record updates atomically once and rejects stale writers for every dialect', async () => {
  for (const kind of ['postgres','mysql','mssql']) {
    let current = null;
    const driver = { async query(sql, v) {
      if (sql.startsWith('INSERT')) { current = { owner: v[0], folder: v[1], project: v[2], revision_token: v[3], body: v[4] }; return [{affected:1}]; }
      if (sql.startsWith('UPDATE')) {
        const matches = current && current.owner === v[2] && current.folder === v[3] && current.project === v[4] && current.revision_token === v[5];
        if (matches) { current.body = v[0]; current.revision_token = v[1]; }
        return [{ affected: matches ? 1 : 0 }];
      }
      return current ? [{...current}] : [];
    } };
    const base = { folder:'F', project:'P' };
    const json = serializeProject([]);
    const old = await databaseProjectAction(driver, kind, 'user-a', { ...base, action:'saveCurrent', expected:null, json });
    const next = await databaseProjectAction(driver, kind, 'user-a', { ...base, action:'saveCurrent', expected:old, json });
    assert.notEqual(old,next);
    await assert.rejects(databaseProjectAction(driver, kind, 'user-a', { ...base, action:'saveCurrent', expected:old, json }), /Conflito/);
    await assert.rejects(databaseProjectAction(driver, kind, 'user-b', { ...base, action:'saveCurrent', expected:next, json }), /Conflito/);
    assert.equal(current.revision_token,next);
  }
});

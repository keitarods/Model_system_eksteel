const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cloudName, cloudVersionName, validateCloudProject, connectCloud } = require('../src/lib/project/cloudStorage.ts');
const { serializeProject, parseProject } = require('../src/lib/project/nativeFormat.ts');

function mock(user = { id: 'user-a' }) {
  const objects = new Map();
  const uploads = [];
  const rows = [];
  function from(name) {
    assert.equal(name, 'eksteel_cad_current');
    let filters = [], update = null, single = false, range = [0, 99999];
    const query = {
      select() { return query; }, eq(key, value) { filters.push([key,value]); return query; },
      order() { return query; }, range(a,b) { range = [a,b]; return query; },
      maybeSingle() { single = true; return query; },
      update(value) { update = value; return query; },
      async insert(row) {
        if (rows.some(r => ['owner_id','folder_name','project_name'].every(k => r[k] === row[k]))) return { error: { code: '23505' } };
        rows.push({ ...row }); return { error: null };
      },
      then(resolve, reject) {
        return Promise.resolve().then(() => {
          const selected = rows.filter(row => filters.every(([k,v]) => row[k] === v)).slice(range[0], range[1]+1);
          if (update) for (const row of selected) Object.assign(row, update);
          return { data: single ? (selected[0] ? { ...selected[0] } : null) : selected.map(r => ({...r})), error: null };
        }).then(resolve,reject);
      }
    };
    return query;
  }
  const bucket = {
    async upload(path, blob, options) {
      uploads.push({ path, options });
      if (objects.has(path)) return { error: { message: 'Duplicate' } };
      objects.set(path, blob); return { error: null };
    },
    async download(path) { return { data: objects.get(path), error: null }; },
    async list(prefix, { limit, offset }) {
      const entries = new Map();
      for (const key of objects.keys()) {
        if (!key.startsWith(prefix + '/')) continue;
        const relative = key.slice(prefix.length + 1);
        const name = relative.split('/')[0];
        entries.set(name, { name, id: relative.includes('/') ? null : 'file-id' });
      }
      return { data: [...entries.values()].sort((a,b) => a.name.localeCompare(b.name)).slice(offset, offset + limit), error: null };
    },
  };
  return { objects, uploads, bucket, rows, client: { from, auth: { getUser: async () => ({ data: { user }, error: null }) }, storage: { from: name => { assert.equal(name, 'cad-projects'); return bucket; } } } };
}

test('cloud names reject traversal, separators and control characters', () => {
  for (const name of ['../other', '.', '..', '/root', 'a/b', 'a\\b', 'x\nsecret', '', 'x'.repeat(81)]) assert.throws(() => cloudName(name));
  assert.equal(cloudName('  Peças 2026 (A)  '), 'Peças 2026 (A)');
});
test('cloud requires authenticated identity before accessing Storage', async () => {
  await assert.rejects(connectCloud(mock(null).client), /Entre na sua conta/);
});
test('private folder and immutable native versions round trip without replacing history', async () => {
  const m = mock(); const cloud = await connectCloud(m.client);
  await cloud.createFolder('Engenharia');
  const first = serializeProject([]);
  const a = await cloud.save('Engenharia', 'Peça', first);
  const b = await cloud.save('Engenharia', 'Peça', serializeProject([], [], { description: 'Revisão' }));
  assert.notEqual(a, b);
  assert.deepEqual(await cloud.folders(), ['Engenharia']);
  assert.deepEqual(await cloud.projects('Engenharia'), ['Peça']);
  assert.equal((await cloud.versions('Engenharia', 'Peça')).length, 2);
  assert.equal(await cloud.open('Engenharia', 'Peça', a), first);
  assert.deepEqual(parseProject(await cloud.open('Engenharia', 'Peça', a)).features, []);
  assert.ok(m.uploads.every(item => item.path.startsWith('user-a/') && item.options.upsert === false));
  await assert.rejects(cloud.open('Engenharia', 'Peça', '../other.eks3d'), /Versão inválida/);
});
test('cloud paginates beyond the first 100 folders', async () => {
  const m = mock(); const cloud = await connectCloud(m.client);
  for (let i = 0; i < 205; i++) m.objects.set(`user-a/Folder${i}/.folder.json`, new Blob(['{}']));
  assert.equal((await cloud.folders()).length, 205);
});
test('invalid native data and failed uploads never report success', async () => {
  const m = mock(); const cloud = await connectCloud(m.client);
  assert.throws(() => validateCloudProject('{}'));
  await assert.rejects(cloud.save('Pasta', 'Peça', '{}'));
  assert.equal(m.uploads.length, 0);
  m.bucket.upload = async () => ({ error: { message: 'Denied' } });
  await assert.rejects(cloud.save('Pasta', 'Peça', serializeProject([])), /Denied/);
});
test('version names use UTC and are safe Storage filenames', () => {
  assert.equal(cloudVersionName(new Date('2026-09-18T15:00:00.000Z'), '00000000-0000-4000-8000-000000000001'), '2026-09-18T15-00-00.000Z_00000000-0000-4000-8000-000000000001.eks3d');
});

test('customer connections only accept HTTPS endpoints and public keys', () => {
  const { validateSupabaseCredentials } = require('../src/lib/project/supabaseConnection.ts');
  const jwt = role => `header.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`;
  assert.deepEqual(validateSupabaseCredentials('https://client.supabase.co/', jwt('anon')), { url: 'https://client.supabase.co', key: jwt('anon') });
  assert.equal(validateSupabaseCredentials('https://client.supabase.co', 'sb_publishable_example').url, 'https://client.supabase.co');
  for (const key of [jwt('service_role'), 'sb_secret_example', 'database-password', '']) assert.throws(() => validateSupabaseCredentials('https://client.supabase.co', key), /chave pública/);
  for (const url of ['http://client.supabase.co', 'https://user:password@client.supabase.co', 'https://client.supabase.co/path', 'https://client.supabase.co?token=secret']) assert.throws(() => validateSupabaseCredentials(url, jwt('anon')));
});


test('current Supabase saves replace one record and reject a second session with an old token', async () => {
  const m = mock(); const a = await connectCloud(m.client); const b = await connectCloud(m.client);
  const first = serializeProject([]);
  await a.saveCurrent('Folder', 'Part', first, null);
  const openedA = await a.current('Folder', 'Part');
  const openedB = await b.current('Folder', 'Part');
  const edited = serializeProject([], [], { description: 'Edited' });
  const token = await a.saveCurrent('Folder', 'Part', edited, openedA.token);
  await assert.rejects(b.saveCurrent('Folder', 'Part', first, openedB.token), /Conflito/);
  await assert.rejects(b.saveCurrent('Folder', 'Part', first, null), /Conflito/);
  assert.equal(m.rows.length, 1);
  assert.equal(m.uploads.length, 0);
  assert.deepEqual(await a.current('Folder', 'Part'), { json: edited, token });
  assert.deepEqual(await a.projects('Folder'), ['Part']);
  const revision = await a.save('Folder', 'Part', edited);
  await a.saveCurrent('Folder', 'Part', first, token);
  assert.equal(await a.open('Folder', 'Part', revision), edited);
});

test('empty accounts cannot report a usable connection when current-table setup is missing', async () => {
  const m = mock();
  m.client.from = () => ({ select() { return this; }, eq() { return this; }, async range() { return { error: { message: 'table missing' } }; } });
  const cloud = await connectCloud(m.client);
  await assert.rejects(cloud.folders(), /table missing/);
});

test('Storage encodes accented paths reversibly, preserves ASCII paths and avoids collisions', async () => {
  const {storageSegment,storageDisplayName}=require('../src/lib/project/cloudStorage.ts');
  for(const name of ['Peças Eksteel','Peça','Peca','Aço','Aço','工具']) {
    const segment=storageSegment(name);
    assert.match(segment,/^[\x20-\x7e]+$/);
    assert.equal(storageDisplayName(segment),name.normalize('NFC'));
  }
  assert.equal(storageSegment('Legacy Folder (1)'), 'Legacy Folder (1)');
  assert.notEqual(storageSegment('Peça'),storageSegment('Peca'));
  assert.equal(storageDisplayName('_u_ff'),'_u_ff');
  const m=mock(); const cloud=await connectCloud(m.client);
  await cloud.createFolder('Peças Eksteel');
  const json=serializeProject([]);
  const version=await cloud.save('Peças Eksteel','Eixo de aço',json);
  assert.ok(m.uploads.every(({path})=>/^[\x20-\x7e]+$/.test(path)));
  assert.deepEqual(await cloud.folders(),['Peças Eksteel']);
  assert.deepEqual(await cloud.projects('Peças Eksteel'),['Eixo de aço']);
  assert.deepEqual(await cloud.versions('Peças Eksteel','Eixo de aço'),[version]);
  assert.equal(await cloud.open('Peças Eksteel','Eixo de aço',version),json);
});

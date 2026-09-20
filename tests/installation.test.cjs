const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { installation, saveInstallation } = require('../src/lib/supabase/installation.ts');
test('installation persists without env credentials and cannot be overwritten', async () => {
 const saved = {...process.env}; const dir = await fs.mkdtemp(path.join(os.tmpdir(),'cad-install-'));
 try {
  process.env.CAD_CONFIG_DIR=dir;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL; delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  assert.equal(await installation(),null);
  const config={url:'https://example.supabase.co',key:'sb_publishable_test'};
  await saveInstallation(config); assert.deepEqual(await installation(),config);
  await assert.rejects(saveInstallation({url:'https://other.supabase.co',key:'other'}));
  assert.deepEqual(await installation(),config);
  process.env.NEXT_PUBLIC_SUPABASE_URL='https://env.supabase.co';process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='env-key';
  assert.equal((await installation()).url,'https://env.supabase.co');
 } finally {
  for(const k of ['CAD_CONFIG_DIR','NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY']) { if(saved[k]===undefined) delete process.env[k]; else process.env[k]=saved[k]; }
  await fs.rm(dir,{recursive:true,force:true});
 }
});

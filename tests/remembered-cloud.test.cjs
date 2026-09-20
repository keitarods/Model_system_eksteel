const {test}=require('node:test');const assert=require('node:assert/strict');
const {rememberCloud,loadRememberedCloud,forgetCloud}=require('../src/lib/project/rememberedCloud.ts');
function memory(){let value=null;return {getItem:()=>value,setItem:(_,v)=>{value=v;},removeItem:()=>{value=null;}};}
test('public preference round trips only URL and key and can be forgotten',()=>{
 const storage=memory();assert.equal(loadRememberedCloud(storage),null);
 rememberCloud(storage,'https://example.supabase.co/','sb_publishable_example');
 assert.deepEqual(loadRememberedCloud(storage),{url:'https://example.supabase.co',key:'sb_publishable_example'});
 assert.deepEqual(Object.keys(JSON.parse(storage.getItem())).sort(),['key','url']);
 forgetCloud(storage);assert.equal(loadRememberedCloud(storage),null);
});
test('privileged or corrupt keys are never restored or persisted',()=>{
 const storage=memory();
 assert.throws(()=>rememberCloud(storage,'https://example.supabase.co','sb_secret_example'));
 assert.equal(storage.getItem(),null);
 storage.setItem('',JSON.stringify({url:'https://example.supabase.co',key:'sb_secret_example'}));assert.equal(loadRememberedCloud(storage),null);
 storage.setItem('','invalid-json');assert.equal(loadRememberedCloud(storage),null);
 assert.equal(loadRememberedCloud({getItem(){throw new Error('blocked');}}),null);
});

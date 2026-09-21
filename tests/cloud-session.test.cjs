const {test}=require('node:test');const assert=require('node:assert/strict');const Module=require('node:module');
const values=new Map();const storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
global.window={sessionStorage:storage};
let signIns=0,signOuts=0,created=0;const original=Module._load;
Module._load=function(name,...args){
 if(name==='@supabase/supabase-js')return {createClient:(url,key,options)=>{
  created++;assert.equal(options.auth.storage,storage);assert.equal(options.auth.persistSession,true);assert.equal(options.auth.detectSessionInUrl,false);
  const authKey=options.auth.storageKey;
  return {auth:{
   signInWithPassword:async()=>{signIns++;storage.setItem(authKey,JSON.stringify({access_token:'test-access',refresh_token:'test-refresh'}));return {error:null};},
   getSession:async()=>({data:{session:storage.getItem(authKey)?{access_token:'test-access'}:null},error:null}),
   getUser:async()=>({data:{user:{id:'test-owner'}},error:null}),
   stopAutoRefresh:()=>{},signOut:async()=>{signOuts++;storage.removeItem(authKey);return {error:null};}
  },storage:{from:()=>({list:async()=>({data:[],error:null})})}};
 }};
 return original.call(this,name,...args);
};
const path=require.resolve('../src/lib/project/supabaseConnection.ts');
const fresh=()=>{delete require.cache[path];return require(path);};
test('Storage restores across reload without password and explicit logout clears tab credentials',async()=>{
 let api=fresh();assert.equal(await api.restoreCustomerSupabase(),null);
 await api.connectCustomerSupabase('https://example.supabase.co','sb_publishable_test','user@example.com','not-persisted-password');
 assert.equal(signIns,1);assert.ok(!JSON.stringify([...values]).includes('not-persisted-password'));
 api=fresh();const [first,second]=await Promise.all([api.restoreCustomerSupabase(),api.restoreCustomerSupabase()]);
 assert.equal(first,second);assert.equal(signIns,1);assert.equal(created,2);assert.equal(first.provider.userId,'test-owner');
 await api.disconnectCustomerSupabase();assert.equal(values.size,0);assert.equal(signOuts,1);
 api=fresh();assert.equal(await api.restoreCustomerSupabase(),null);
});
test('remembering an email is independent from the public connection preference',()=>{
 const p=require('../src/lib/project/rememberedCloud.ts');
 p.rememberCloudUser(storage,' user@example.com ');assert.equal(p.loadRememberedCloudUser(storage),'user@example.com');
 p.rememberCloud(storage,'https://example.supabase.co','sb_publishable_test');
 p.forgetCloudUser(storage);assert.equal(p.loadRememberedCloudUser(storage),'');assert.ok(p.loadRememberedCloud(storage));
});

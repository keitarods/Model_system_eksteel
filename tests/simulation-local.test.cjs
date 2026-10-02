const {test}=require('node:test');const assert=require('node:assert/strict');
const api=require('../src/lib/simulation/client.ts');
const id='11111111-1111-1111-1111-111111111111';const token='t'.repeat(43),code='c'.repeat(32);
test('local mode requires explicit pairing and never falls back to the cloud',async()=>{
 const original=global.fetch;const calls=[];
 global.fetch=async(url,init)=>{calls.push([url,init]);throw new TypeError('Offline');};
 try{await api.setFeaTarget('local');await assert.rejects(api.feaRequest(),/comunicador/);assert.equal(calls.length,0);await assert.rejects(api.connectLocalFea(code),/Não foi possível/);assert.ok(calls.every(([url])=>url.startsWith('http://127.0.0.1:8091/')));}
 finally{global.fetch=original;}
});
test('jobs, input and cancellation use the paired loopback transport',async()=>{
 const original=global.fetch;const calls=[];const controller=new AbortController();
 global.fetch=async(url,init)=>{
  calls.push([url,init]);
  if(url.endsWith('/pair'))return {ok:true,json:async()=>({protocol:1,token})};
  if(init?.method==='POST'){controller.abort();return {ok:true,json:async()=>({id})};}
  if(url.endsWith('/input'))return {ok:true,text:async()=>'*HEADING'};
  return {ok:true,json:async()=>({ready:true})};
 };
 try{
  await api.connectLocalFea(code);await api.feaRequest();assert.equal(await api.feaInput(id),'*HEADING');
  await assert.rejects(api.runFeaJob({},controller.signal,()=>{},()=>{}),{name:'AbortError'});
  assert.ok(calls.some(([url,init])=>url.endsWith('/jobs/'+id)&&init.method==='DELETE'));
  const health=calls.find(([url])=>url.endsWith('/health'));assert.equal(health[1].headers.get('Authorization'),'Bearer '+token);assert.equal(health[1].credentials,'omit');
  assert.ok(calls.every(([url])=>!url.includes('/api/simulation')));
  assert.deepEqual(api.feaConnection(),{target:'local',connected:true});
  await api.disconnectLocalFea();assert.ok(calls.some(([url])=>url.endsWith('/disconnect')));
  assert.equal(api.feaConnection().connected,false);
 }finally{global.fetch=original;}
});
test('a job keeps its executor even if selection changes during submission',async()=>{
 const original=global.fetch;const calls=[];const controller=new AbortController();
 global.fetch=async(url,init)=>{
  calls.push([url,init]);
  if(url.endsWith('/pair'))return {ok:true,json:async()=>({protocol:1,token})};
  if(url.endsWith('/jobs')&&init.method==='POST'){await api.setFeaTarget('server');controller.abort();return {ok:true,json:async()=>({id})};}
  return {ok:true,json:async()=>({})};
 };
 try{await api.connectLocalFea(code);await assert.rejects(api.runFeaJob({},controller.signal,()=>{},()=>{}),{name:'AbortError'});assert.ok(calls.some(([url,init])=>url==='http://127.0.0.1:8091/jobs/'+id&&init.method==='DELETE'));assert.ok(calls.every(([url])=>!url.startsWith('/api/')));}
 finally{global.fetch=original;}
});
test('approval flow connects without a code and polls until desktop consent',async()=>{
 const original=global.fetch;const calls=[];const requestId='a'.repeat(32),requestToken='r'.repeat(32);let polls=0;const messages=[];
 global.fetch=async(url,init)=>{
  calls.push([url,init]);
  if(url.endsWith('/connect'))return {ok:true,json:async()=>({id:requestId,requestToken})};
  if(url.endsWith('/connect/'+requestId))return {ok:true,json:async()=>++polls===1?{status:'pending'}:{status:'approved',protocol:2,token}};
  return {ok:true,json:async()=>({})};
 };
 try{
  await api.setFeaTarget('local');assert.equal(await api.requestLocalFeaConnection({onStatus:m=>messages.push(m)}),true);
  assert.equal(calls.find(([url])=>url.endsWith('/connect'))[1].headers['X-Eksteel-Connect'],'request');
  assert.equal(polls,2);assert.match(messages[0],/Aceite/);assert.equal(api.feaConnection().connected,true);
  assert.ok(calls.every(([url])=>!url.endsWith('/pair')&&!url.startsWith('/api/')));
  await api.disconnectLocalFea();
 }finally{global.fetch=original;}
});
test('automatic reconnect does not prompt a site which was not remembered',async()=>{
 const original=global.fetch;const calls=[];
 global.fetch=async(url,init)=>{calls.push([url,init]);return {ok:true,json:async()=>({status:'approval_required'})};};
 try{assert.equal(await api.requestLocalFeaConnection({automatic:true}),false);assert.equal(calls.length,1);assert.equal(calls[0][1].headers['X-Eksteel-Connect'],'automatic');}
 finally{global.fetch=original;}
});
test('cancelling while requesting permission removes the pending desktop request',async()=>{
 const original=global.fetch;const calls=[];const control=new AbortController();const requestId='b'.repeat(32),requestToken='r'.repeat(32);
 global.fetch=async(url,init)=>{calls.push([url,init]);if(url.endsWith('/connect')){control.abort();return {ok:true,json:async()=>({id:requestId,requestToken})};}return {ok:true,json:async()=>({})};};
 try{await assert.rejects(api.requestLocalFeaConnection({signal:control.signal}),{name:'AbortError'});assert.ok(calls.some(([url,init])=>url.endsWith('/connect/'+requestId)&&init.method==='DELETE'&&init.keepalive));assert.equal(api.feaConnection().connected,false);}
 finally{global.fetch=original;}
});
test('desktop denial does not enable calculation',async()=>{
 const original=global.fetch;const requestId='b'.repeat(32),requestToken='r'.repeat(32);
 global.fetch=async(url,init)=>({ok:true,json:async()=>url.endsWith('/connect')?{id:requestId,requestToken}:{status:'denied'}});
 try{await assert.rejects(api.requestLocalFeaConnection(),/recusada/);assert.equal(api.feaConnection().connected,false);}
 finally{global.fetch=original;}
});
test('an unresponsive approval poll times out even with a caller signal and cleans up',async()=>{
 const original=global.fetch,originalTimeout=AbortSignal.timeout;const timeouts=[];const calls=[];
 const requestId='d'.repeat(32),requestToken='r'.repeat(32);const caller=new AbortController();
 AbortSignal.timeout=()=>{const controller=new AbortController();timeouts.push(controller);return controller.signal;};
 global.fetch=async(url,init)=>{
  calls.push([url,init]);
  if(url.endsWith('/connect'))return {ok:true,json:async()=>({id:requestId,requestToken})};
  if(init.method==='DELETE')return {ok:true,json:async()=>({})};
  return new Promise((resolve,reject)=>{
   init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true});
   timeouts.at(-1).abort(new DOMException('Timed out','TimeoutError'));
  });
 };
 try{
  await assert.rejects(api.requestLocalFeaConnection({signal:caller.signal}),/Não foi possível alcançar/);
  assert.equal(caller.signal.aborted,false);
  assert.ok(calls.some(([url,init])=>url.endsWith('/connect/'+requestId)&&init.method==='DELETE'));
  assert.equal(api.feaConnection().connected,false);
 }finally{global.fetch=original;AbortSignal.timeout=originalTimeout;}
});
test('closed communicator gives an actionable error without enabling calculation',async()=>{
 const original=global.fetch;
 global.fetch=async()=>{throw new TypeError('Failed to fetch');};
 try{await assert.rejects(api.requestLocalFeaConnection(),/Abra o aplicativo Eksteel Comunicador/);assert.equal(api.feaConnection().connected,false);}
 finally{global.fetch=original;}
});

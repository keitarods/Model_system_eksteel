const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {POST}=require('../src/app/api/auth/check-email/route.ts');
test('legacy account check neither requires admin credentials nor discloses accounts',async()=>{
 const result=await POST();
 assert.equal(result.status,200);
 assert.deepEqual(await result.json(),{exists:null});
 assert.equal(result.headers.get('Cache-Control'),'no-store');
});
test('login authenticates directly without an administrative email lookup',()=>{
 const code=fs.readFileSync(path.join(__dirname,'../src/app/login/page.tsx'),'utf8');
 assert.match(code,/auth\.signInWithPassword/);
 assert.doesNotMatch(code,/SUPABASE_SERVICE_ROLE_KEY|verificarEmailCadastrado|\/api\/auth\/check-email/);
 assert.match(code,/if \(tempoRestante > 0\)/);
});

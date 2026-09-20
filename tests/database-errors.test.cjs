const { test } = require('node:test');
const assert = require('node:assert/strict');
const { databaseErrorMessage: message } = require('../src/lib/project/server/databaseErrors.ts');
test('driver diagnostics distinguish causes without leaking credentials', () => {
 for (const [code,expected] of [['28P01',/Autenticação/],['ENOTFOUND',/resolver/],['ENETUNREACH',/IPv6/],['ECONNREFUSED',/recusada/],['SELF_SIGNED_CERT_IN_CHAIN',/TLS/],['ETIMEDOUT',/Tempo limite/],['42501',/Permissão/],['23505',/Já existe/],['42P01',/Estrutura/]]) {
  const result = message({code,message:'password=SUPERSECRET postgresql://user:SUPERSECRET@host/db'});
  assert.match(result,expected); assert.ok(!result.includes('SUPERSECRET'));
 }
});
test('nested, aggregate, cyclic and unknown errors are safely handled', () => {
 assert.match(message({originalError:{code:'ELOGIN'}}),/Autenticação/);
 assert.match(message({errors:[{code:'EHOSTUNREACH'}]}),/Rede/);
 assert.match(message({message:'Tenant or user not found'}),/pooler/);
 assert.match(message({message:'Connection timeout expired'}),/Tempo limite/);
 const error={message:'SECRET'};error.cause=error;
 assert.match(message(error),/não identificada/);
 assert.ok(!message(error).includes('SECRET'));
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseConnectionString: parse } = require('../src/lib/project/connectionString.ts');
test('Supabase URI parses encoded credentials and session pooler coordinates', () => {
  assert.deepEqual(parse('postgresql://postgres.ref:p%40ss%3A%2F%23%25@aws-0-region.pooler.supabase.com:5432/postgres?sslmode=require', 'postgres'), {
    kind:'postgres',host:'aws-0-region.pooler.supabase.com',port:5432,database:'postgres',username:'postgres.ref',password:'p@ss:/#%'
  });
  assert.equal(parse('postgres://postgres:[YOUR-PASSWORD]@db.example.com/postgres', 'postgres').password, '');
});
test('supported engines get correct defaults and explicit ports', () => {
  assert.equal(parse('mysql://user:pass@db.example.com/cad', 'mysql').port,3306);
  assert.equal(parse('sqlserver://user:pass@db.example.com/cad', 'mssql').port,1433);
  assert.equal(parse('mssql://user:pass@db.example.com:1444/cad', 'mssql').port,1444);
});
test('malformed strings and unsafe options fail without echoing secrets', () => {
  for (const value of ['postgres://u:SECRET@host/db?sslmode=disable','postgres://u:SECRET@host/db?host=other','postgres://u:SECRET@host/db#fragment','postgres://u:SECRET@host/','postgres://u:SECRET@host/db/extra','postgres://u:SECRET%XX@host/db','garbageSECRET']) {
    assert.throws(() => parse(value,'postgres'), e => !e.message.includes('SECRET'));
  }
  assert.throws(() => parse('mysql://user:pass@host/db','postgres'), /protocolo/);
});

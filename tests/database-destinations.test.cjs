const { test }=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {destinationAddress,authorizeDestination,allowedDestinationsFor}=require('../src/lib/project/server/destinations.ts');
const {canConfigureInstallation}=require('../src/lib/supabase/setupAuthorization.ts');
test('destinations persist independently, reject malformed addresses and preserve environment grants', async()=>{
 const old=process.env.CAD_CONFIG_DIR, env=process.env.CAD_DATABASE_ALLOWED_HOSTS;
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cad-dest-'));
 process.env.CAD_CONFIG_DIR=dir;process.env.CAD_DATABASE_ALLOWED_HOSTS='legacy.example.com:5432';
 try {
  assert.throws(()=>destinationAddress('../private',5432));assert.throws(()=>destinationAddress('host',0));assert.throws(()=>destinationAddress('host','5432'));
  const a={host:'db.example.com',port:5432},b={host:'other.example.com',port:3306};
  assert.equal(await allowedDestinationsFor(a),'legacy.example.com:5432');
  await Promise.all([authorizeDestination(a.host,a.port),authorizeDestination(b.host,b.port)]);
  await authorizeDestination(a.host,a.port);
  assert.match(await allowedDestinationsFor(a),/db.example.com:5432/);
  assert.match(await allowedDestinationsFor(b),/other.example.com:3306/);
  assert.equal(await allowedDestinationsFor({...a,port:5433}),'legacy.example.com:5432');
 } finally {if(old===undefined)delete process.env.CAD_CONFIG_DIR;else process.env.CAD_CONFIG_DIR=old;if(env===undefined)delete process.env.CAD_DATABASE_ALLOWED_HOSTS;else process.env.CAD_DATABASE_ALLOWED_HOSTS=env;await fs.rm(dir,{recursive:true,force:true});}
});
test('production destination authorization requires administrator token; local exception is development only',()=>{
 const mode=process.env.NODE_ENV,token=process.env.CAD_SETUP_TOKEN;
 try {
  process.env.NODE_ENV='production';delete process.env.CAD_SETUP_TOKEN;
  assert.equal(canConfigureInstallation('http://localhost',''),false);
  process.env.CAD_SETUP_TOKEN='a'.repeat(32);
  assert.equal(canConfigureInstallation('https://cad.example.com','b'.repeat(32)),false);
  assert.equal(canConfigureInstallation('https://cad.example.com','a'.repeat(32)),true);
  process.env.NODE_ENV='development';
  assert.equal(canConfigureInstallation('http://localhost:3000',''),true);
  assert.equal(canConfigureInstallation('https://cad.example.com',''),false);
 }finally{if(mode===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=mode;if(token===undefined)delete process.env.CAD_SETUP_TOKEN;else process.env.CAD_SETUP_TOKEN=token;}
});

test('CA uploads validate public CA certificates and persist only for the approved endpoint',async()=>{
 const {validateDatabaseCa,destinationCa}=require('../src/lib/project/server/destinations.ts');
 const {X509Certificate}=require('node:crypto');
 const pem=require('node:tls').rootCertificates.find(value=>{const cert=new X509Certificate(value);return cert.ca && Date.parse(cert.validFrom)<Date.now() && Date.parse(cert.validTo)>Date.now();});
 assert.ok(pem);
 assert.match(validateDatabaseCa(pem),/BEGIN CERTIFICATE/);
 for(const value of ['', 'password', pem+'\n-----BEGIN PRIVATE KEY-----', 'x'.repeat(65537), '-----BEGIN CERTIFICATE-----\ninvalid\n-----END CERTIFICATE-----']) assert.throws(()=>validateDatabaseCa(value));
 const old=process.env.CAD_CONFIG_DIR;
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cad-ca-'));process.env.CAD_CONFIG_DIR=dir;
 try{
  await authorizeDestination('db.example.com',5432,pem);
  assert.equal(await destinationCa('db.example.com',5432),validateDatabaseCa(pem));
  assert.equal(await destinationCa('other.example.com',5432),undefined);
  assert.equal(await destinationCa('db.example.com',5433),undefined);
  await authorizeDestination('db.example.com',5432);
  assert.equal(await destinationCa('db.example.com',5432),validateDatabaseCa(pem));
  await assert.rejects(authorizeDestination('db.example.com',5432,'bad'));
  assert.equal(await destinationCa('db.example.com',5432),validateDatabaseCa(pem));
 }finally{if(old===undefined)delete process.env.CAD_CONFIG_DIR;else process.env.CAD_CONFIG_DIR=old;await fs.rm(dir,{recursive:true,force:true});}
});

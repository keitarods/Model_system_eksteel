const {test}=require('node:test');
const assert=require('node:assert/strict');
const {publicDownloadUrl,communicatorDownloads}=require('../src/lib/simulation/communicatorDownloads.ts');
const {releaseDownload}=require('../src/lib/simulation/communicatorDownloads.ts');
test('published releases stay inside the expected platform and public release bucket',()=>{
 const base='https://storage.example.com';
 const release={platform:'linux',path:'linux/2026.10.8/installer.deb',sha256:'a'.repeat(64),size:100};
 assert.equal(releaseDownload(base,'linux',release),base+'/storage/v1/object/public/fea-releases/linux/2026.10.8/installer.deb');
 for(const path of ['https://evil.example/file.deb','linux/../../private/file.deb','windows/1/setup.exe','linux/1/file.deb?token=secret'])
  assert.equal(releaseDownload(base,'linux',{...release,path}),null);
 assert.equal(releaseDownload(base,'windows',release),null);
 assert.equal(releaseDownload(base,'linux',{...release,sha256:'invalid'}),null);
 assert.equal(releaseDownload(base,'linux',null),null);
});
test('downloads expose only explicitly configured public HTTPS packages',()=>{
 assert.deepEqual(communicatorDownloads({}),{windows:null,linux:null});
 assert.deepEqual(communicatorDownloads({FEA_COMMUNICATOR_WINDOWS_URL:'https://downloads.example.com/setup.exe',FEA_API_TOKEN:'private'}),{windows:'https://downloads.example.com/setup.exe',linux:null});
 for(const value of ['javascript:alert(1)','http://example.com/setup.exe','file:///installer.exe','//example.com/file','https://user:password@example.com/setup.exe','https://example.com/setup.exe?token=private','https://example.com/setup.exe#secret'])assert.equal(publicDownloadUrl(value),null);
});

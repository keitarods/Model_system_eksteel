const {test}=require('node:test');const assert=require('node:assert/strict');
const {validateDocument,createDocumentLibrary}=require('../src/lib/project/cloudDocuments.ts');
const {serializeProject}=require('../src/lib/project/nativeFormat.ts');
const {serializeAssembly,parseAssembly}=require('../src/lib/project/assemblyFormat.ts');
const {portableAssembly}=require('../src/lib/project/portableAssembly.ts');
const component={id:'i1',linkKey:'part1',sourceFileName:'part.eks3d',label:'Part',grounded:true,suppressed:false,visible:true,placementSeed:{position:[0,0,0],quaternion:[0,0,0,1]}};
test('portable assemblies retain component features/properties and read shared dependencies once',async()=>{
 let calls=0;const part=serializeProject([],[],{description:'Aço'});
 const json=await portableAssembly([component,{...component,id:'i2'}],[],[],async()=>{calls++;return part;});
 assert.equal(calls,1);const doc=parseAssembly(json);assert.equal(doc.instances[0].embeddedPart,part);
 assert.equal(doc.instances[1].embeddedPart,part);
 assert.equal(await validateDocument('Assembly.eks3dasm',new Blob([json])),'assembly');
 await assert.rejects(validateDocument('Missing.eks3dasm',new Blob([serializeAssembly([component],[])])),/depende/);
 await assert.rejects(portableAssembly([component],[],[],async()=>{throw new Error('missing dependency');}),/missing dependency/);
});
test('library validates formats and rejects spoofed extensions',async()=>{
 assert.equal(await validateDocument('Peça.eks3d',new Blob([serializeProject([])])),'part');
 assert.equal(await validateDocument('Desenho.pdf',new Blob(['%PDF-1.7\n'])),'pdf');
 assert.equal(await validateDocument('Corte.dxf',new Blob(['0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n'])),'dxf');
 for(const [name,content] of [['X.pdf','not pdf'],['X.dxf','not dxf'],['X.exe','x'],['../X.pdf','%PDF-'],['X.eks3d','{}']]) await assert.rejects(validateDocument(name,new Blob([content])));
});
test('native file uploads link catalog metadata to the exact private Storage object; failures never publish metadata',async()=>{
 const calls=[];let uploadError=null;let insertError=null;
 const client={storage:{from(bucket){assert.equal(bucket,'cad-documents');return {async upload(path,body,options){calls.push({path,body,options});return {error:uploadError};}};}},from(table){assert.equal(table,'eksteel_cad_documents');return {async insert(row){calls.push(row);return {error:insertError};}};}};
 const library=createDocumentLibrary(client,'owner');const blob=new Blob([serializeProject([])]);
 await library.upload('Peças','Eixo','Eixo.eks3d',blob,'Compra');
 assert.equal(calls.length,2);assert.equal(calls[1].object_path,calls[0].path);assert.equal(calls[1].owner_id,'owner');assert.equal(calls[1].source_name,'Eixo');assert.equal(calls[0].body,blob);assert.equal(calls[0].options.upsert,false);assert.match(calls[0].path,/^owner\/_u_/);
 calls.length=0;uploadError={message:'denied'};await assert.rejects(library.upload('F','P','P.eks3d',blob,''),/denied/);assert.equal(calls.length,1);
 uploadError=null;insertError={message:'denied'};await assert.rejects(library.upload('F','P','P.eks3d',blob,''),/não foi possível registrar/);
});

test('library paginates catalog and downloads the selected immutable object',async()=>{
 const rows=Array.from({length:205},(_,i)=>({id:String(i),object_path:`owner/f/${i}/file.pdf`}));
 let pages=0;let downloaded='';
 const client={from(){return {select(){return this;},eq(){return this;},order(){return this;},async range(a,b){pages++;return {data:rows.slice(a,b+1),error:null};}};},storage:{from(){return {async download(path){downloaded=path;return {data:new Blob(['%PDF-1.7']),error:null};}};}}};
 const library=createDocumentLibrary(client,'owner');const docs=await library.list('Folder');
 assert.equal(docs.length,205);assert.equal(pages,3);
 assert.equal(await (await library.download(docs[2])).text(),'%PDF-1.7');assert.equal(downloaded,rows[2].object_path);
});

test('export queue is bounded and does not accept unrelated files',()=>{
 const {useExportQueue}=require('../src/lib/project/exportQueue.ts');
 useExportQueue.setState({files:[]});
 useExportQueue.getState().add('file.exe',new Blob(['x']));assert.equal(useExportQueue.getState().files.length,0);
 for(let i=0;i<7;i++)useExportQueue.getState().add(`file${i}.pdf`,new Blob(['%PDF-']));
 assert.equal(useExportQueue.getState().files.length,5);assert.equal(useExportQueue.getState().files[0].filename,'file6.pdf');
 const id=useExportQueue.getState().files[0].id;useExportQueue.getState().remove(id);assert.equal(useExportQueue.getState().files.length,4);
 useExportQueue.setState({files:[]});
});

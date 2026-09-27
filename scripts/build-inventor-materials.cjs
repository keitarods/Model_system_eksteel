// Gera o SQL da biblioteca padrão de materiais a partir de um .adsklib do Inventor (arquivo ZIP
// ou pasta descompactada). O SQL é privado (*.sql fica fora do Git) e deve ser aplicado no
// SQL Editor do Supabase de login — ver docs/MATERIALS.md.
// Uso: node --require ./scripts/register-tests.cjs scripts/build-inventor-materials.cjs <path.adsklib> [saída.sql]
const fs=require('node:fs');const path=require('node:path');
const {parseAdsklib,unzipAdsklib}=require('../src/lib/materials/adsklib.ts');
const {materialsSql}=require('../src/lib/materials/materialsSql.ts');
const {NAMES,CATEGORIES}=require('./inventor-material-names-pt.cjs');
const input=process.argv[2];
if(!input)throw new Error('Informe o caminho do .adsklib.');
const output=process.argv[3]??path.join(__dirname,'../supabase/migrations/202609270005_eksteel_materials.sql');
if(!output.endsWith('.sql'))throw new Error('A saída deve ser um arquivo .sql (ignorado pelo Git).');
function readFolder(root){
  const files={};
  const walk=dir=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){const full=path.join(dir,e.name);if(e.isDirectory())walk(full);else files[path.relative(root,full).split(path.sep).join('/')]=new Uint8Array(fs.readFileSync(full));}};
  walk(root);return files;
}
const files=fs.statSync(input).isDirectory()?readFolder(input):unzipAdsklib(new Uint8Array(fs.readFileSync(input)));
const library=path.basename(input);
const materials=parseAdsklib(files,library).map(m=>{
  const id=m.id.split(':').pop(),name=NAMES[id];
  if(!name)console.warn(`Sem tradução para ${id} (${m.name}); mantido o nome original.`);
  // O nome original fica na origem, para a pesquisa em inglês continuar encontrando o material.
  return {...m,name:name??m.name,category:CATEGORIES[m.category]??m.category,source:`${m.source} · ${m.name}`};
});
fs.mkdirSync(path.dirname(output),{recursive:true});
fs.writeFileSync(output,materialsSql(materials,library,library),{mode:0o600});
console.log(`${materials.length} materiais gravados em ${path.relative(process.cwd(),output)} (arquivo privado, fora do Git).`);

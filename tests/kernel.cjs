const fs=require('node:fs');const path=require('node:path');
module.exports=async function(){
  // Emscripten's published glue mixes ESM export with Node __dirname.
  // Compile it as CommonJS for this Node-only integration test.
  const Module = require('node:module');
  const ts = require('typescript');
  const filename = require.resolve('replicad-opencascadejs');
  const glue = new Module(filename, module);
  glue.filename = filename;
  glue.paths = module.paths;
  glue._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, filename);
  const init = glue.exports.default;
  const oc = await init({ wasmBinary: fs.readFileSync(path.join(__dirname,'../public/wasm/replicad_single.wasm')) });
  require('replicad').setOC(oc);
  return oc;
};

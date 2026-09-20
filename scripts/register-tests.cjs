// Execute the repository's TypeScript with Node's test runner, without a new dependency.
const ts = require('typescript');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const resolve = Module._resolveFilename;
Module._resolveFilename = function (id, ...args) {
  return resolve.call(this, id.startsWith('@/') ? path.join(__dirname, '../src', id.slice(2)) : id, ...args);
};
const compile = (module, filename) => {
  const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
    fileName: filename,
  });
  module._compile(result.outputText, filename);
};

require.extensions['.ts'] = compile;
require.extensions['.tsx'] = compile;

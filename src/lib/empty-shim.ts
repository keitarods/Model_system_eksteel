// Alvo do resolveAlias (Turbopack) para 'fs' / 'path' / 'crypto'.
//
// O glue code do OpenCascade (Emscripten) e o replicad fazem require("fs")
// dentro de um branch só executado em Node (atrás de checagens de
// ENVIRONMENT_IS_NODE / typeof window). No browser esse branch nunca roda,
// mas o bundler ainda precisa resolver o import estaticamente — este módulo
// vazio só existe para isso. Exporta default (alguns trechos fazem
// `require("fs")` tratado como default import pelo interop do bundler) além
// de um Proxy que aceita qualquer propriedade acessada sem quebrar.
const empty = new Proxy(
  {},
  {
    get: () => () => undefined,
  }
);

export default empty;

import { setOC } from "replicad";
import type { OpenCascadeInstance } from "replicad-opencascadejs";

// O .d.ts gerado para o glue code do Emscripten declara init() sem
// parâmetros, mas o factory aceita { locateFile } em tempo de execução —
// é assim que apontamos pro .wasm servido em /public (ver README do replicad).
type InitOpenCascade = (options?: {
  locateFile?: (path: string) => string;
}) => Promise<OpenCascadeInstance>;

let ocPromise: Promise<void> | null = null;

// OpenCascade (via WASM) só existe no browser e só deve ser inicializado uma
// vez por sessão — chamadas seguintes reaproveitam a mesma promise. O import
// do glue code é dinâmico de propósito: ele carrega o binário .wasm (~10MB)
// e não deve entrar no bundle inicial da página, só quando for realmente usado.
export function loadOpenCascade(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(
      new Error("loadOpenCascade só pode ser chamado no browser")
    );
  }

  if (!ocPromise) {
    ocPromise = import("replicad-opencascadejs/src/replicad_single.js")
      .then((mod) => {
        const init = mod.default as unknown as InitOpenCascade;
        return init({ locateFile: () => "/wasm/replicad_single.wasm" });
      })
      .then((oc) => {
        setOC(oc);
      });
  }

  return ocPromise;
}

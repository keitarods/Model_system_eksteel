import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    resolveAlias: {
      // O glue WASM do OpenCascade e o replicad fazem require("fs"/"path")
      // dentro de branches Node-only que nunca rodam no browser — ver
      // src/lib/empty-shim.ts.
      fs: "./src/lib/empty-shim.ts",
      path: "./src/lib/empty-shim.ts",
      crypto: "./src/lib/empty-shim.ts",
    },
  },
};

export default nextConfig;

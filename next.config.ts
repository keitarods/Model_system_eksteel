import type { NextConfig } from "next";
import { existsSync } from "node:fs";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/project-database": ["./database/*.sql", "./supabase/migrations/*.sql"].filter(pattern => existsSync(pattern.split("/*")[0])),
  },
  // SQL drivers run only on Node; do not apply the browser WASM shims to them.
  serverExternalPackages: ["pg", "mysql2", "mssql"],
  // Equivalent browser-only shims for the optional Webpack build path.
  webpack(config, { isServer }) {
    if (!isServer) {
      config.resolve.fallback = { ...config.resolve.fallback, fs: false, path: false, crypto: false };
    }
    return config;
  },
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

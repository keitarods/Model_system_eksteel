"use client";

import dynamic from "next/dynamic";

/** Stable server/first-client boundary; CAD controls are created in the browser.
 * The interactive workspace depends on browser state and a WebGL/WASM runtime.
 * Keep authentication in the server page, outside this boundary.
 */
const Workspace = dynamic(
  () => import("./ModeladorWorkspace").then(module => module.ModeladorWorkspace),
  {
    ssr: false,
    loading: () => (
      <main className="flex h-dvh items-center justify-center bg-chrome-surface text-chrome-text" aria-busy="true">
        <p role="status">Carregando modelador…</p>
      </main>
    ),
  },
);

export function ModeladorClient({ userEmail }: { userEmail: string }) {
  return <Workspace userEmail={userEmail} />;
}

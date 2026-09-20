"use client";

import { useId, useRef, useState, type ReactNode } from "react";

/** Native popover uses the top layer, so the header's scrolling cannot clip it.
 * Keep children mounted: cloud connections and their dialogs survive dismissal.
 */
export function ApplicationFileMenu({ children }: { children: ReactNode }) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" popoverTarget={id} aria-expanded={open} aria-controls={id}
      aria-label="Arquivo — abrir, salvar, importar e exportar" title="Arquivo"
      className="flex shrink-0 items-center gap-2 rounded-md px-2 py-1 hover:bg-chrome-surface-alt focus-visible:outline-2 focus-visible:outline-primary">
      {/* eslint-disable-next-line @next/next/no-img-element -- local logo shared with the workspace */}
      <img src="/images/Eksteel-logo.png" alt="Eksteel" className="h-7 w-auto object-contain" />
      <span aria-hidden="true" className="text-xs">▾</span>
    </button>
    <div id={id} ref={panel} popover="auto" onToggle={event => setOpen(event.newState === "open")}
      aria-label="Arquivo" style={{ margin: 0, top: 52, left: 12 }}
      className="fixed max-h-[calc(100dvh-64px)] w-80 max-w-[calc(100vw-24px)] overflow-y-auto rounded-xl border border-chrome-border bg-chrome-bg p-3 text-chrome-text shadow-2xl"
      onClickCapture={event => {
        if ((event.target as Element).closest('button:not(:disabled)')) panel.current?.hidePopover();
      }}>
      <h2 className="mb-2 border-b border-chrome-border px-2 pb-2 text-sm font-semibold">Arquivo</h2>
      <div className="flex flex-col gap-1 [&>button]:flex [&>button]:w-full [&>button]:max-w-none [&>button]:items-center [&>button]:gap-3 [&>button]:px-3 [&>button]:py-2 [&>button]:text-left [&>button]:text-sm">
        {children}
      </div>
    </div>
  </>;
}

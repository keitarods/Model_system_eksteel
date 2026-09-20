/** Original quick-access icons; labels are supplied by the owning button. */
export function HeaderIcon({ kind }: { kind: string }) {
  const paths: Record<string, string> = {
    folder: 'M2 6h7l2 2h11v12H2Z M2 6V4h7l2 2',
    open: 'M2 8h8l2 2h10l-3 10H2Z M2 8V5h8l2 3',
    close: 'M5 3h10l4 4v14H5Z M9 11l6 6m0-6-6 6',
    save: 'M3 3h15l3 3v15H3Z M7 3v6h10V3 M7 21v-8h10v8',
    saveAs: 'M3 3h13l3 3v5 M3 3v18h8 M7 3v6h8V3 M13 18l6-6 3 3-6 6h-3Z',
    assembly: 'm3 7 5-3 5 3-5 3Z M3 7v6l5 3 5-3V7 M8 10v6 M13 13l4-2 5 3-5 3-4-2 M17 17v5l5-3v-5',
    properties: 'M5 3h14v18H5Z M8 7h8 M8 12h2m3 0h3 M8 17h2m3 0h3',
    cloud: 'M6 18a5 5 0 0 1-1-10 7 7 0 0 1 13-1 5.5 5.5 0 0 1 0 11Z',
    import: 'M4 3h10l6 6v12H4Z M14 3v6h6 M1 13h12m-4-4 4 4-4 4',
    reconstruct: 'M5 7a8 8 0 1 1-1 9 M5 2v5H0 M8 10l4-2 4 2v6l-4 2-4-2Z M8 10l4 2 4-2 M12 12v6',
    step: 'm3 7 8-4 8 4-8 4Z M3 7v10l8 4 8-4V7 M11 11v10 M17 2h5v5m0-5-6 6',
    stl: 'm3 18 8-15 10 15Z M3 18l9-6 9 6 M11 3l1 9v6',
    dxf: 'M3 3h14v18H3Z M6 17l3-9 5 7 M6 6h8 M17 10h6m-3-3 3 3-3 3',
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={paths[kind] || paths.properties}/></svg>;
}

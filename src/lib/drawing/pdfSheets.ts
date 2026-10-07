/** Resolve page selection in document order, never checkbox click order. */
export function selectPdfSheets<T extends { id: string }>(
  sheets: readonly T[], currentId: string | undefined,
  scope: 'current' | 'all' | 'selected', selectedIds: readonly string[],
): T[] {
  const ids = new Set(selectedIds);
  const selected = sheets.filter(sheet => scope === 'all' || (scope === 'current' ? sheet.id === currentId : ids.has(sheet.id)));
  if (!selected.length) throw new Error('Selecione pelo menos uma folha para exportar em PDF.');
  return selected;
}

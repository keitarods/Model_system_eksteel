import type { DrawingSheet } from './types';
export const DRAWING_EXTENSION = '.eksdesenho';
export function serializeDrawing(sheets: DrawingSheet[]): string {
  const json = JSON.stringify({ format: 'eksteel-drawing', version: 1, sheets });
  parseDrawing(json);
  return json;
}
export function parseDrawing(json: string): DrawingSheet[] {
  const doc = JSON.parse(json);
  if (doc?.format !== 'eksteel-drawing' || doc.version !== 1 || !Array.isArray(doc.sheets) || !doc.sheets.length)
    throw new Error('Arquivo de desenho Eksteel inválido ou versão não suportada.');
  const ids = new Set<string>();
  for (const sheet of doc.sheets) {
    if (!sheet || typeof sheet.id !== 'string' || ids.has(sheet.id) || typeof sheet.name !== 'string' ||
      !['A4', 'A3'].includes(sheet.size) || !['landscape', 'portrait'].includes(sheet.orientation) ||
      !Number.isFinite(sheet.scale) || sheet.scale <= 0 || !Array.isArray(sheet.views) ||
      !Array.isArray(sheet.dimensions) || !Array.isArray(sheet.annotations) || !sheet.titleBlock ||
      typeof sheet.titleBlock !== 'object') throw new Error('Estrutura da folha inválida.');
    ids.add(sheet.id);
    for (const dimension of sheet.dimensions) {
      if (!dimension || typeof dimension.id !== 'string' || ![dimension.x1, dimension.y1, dimension.x2, dimension.y2, dimension.offset].every(Number.isFinite))
        throw new Error('Cota de desenho inválida.');
    }
    for (const annotation of sheet.annotations) {
      if (!annotation || typeof annotation.text !== 'string' || !['text','chamfer','thread','weld'].includes(annotation.kind) ||
        !(annotation.kind === 'weld' ? [annotation.x1,annotation.y1,annotation.x2,annotation.y2] : [annotation.x,annotation.y]).every(Number.isFinite))
        throw new Error('Anotação de desenho inválida.');
    }
    if (sheet.bomTables !== undefined && !Array.isArray(sheet.bomTables)) throw new Error('Lista de peças inválida.');
    for (const view of sheet.views) {
      if (!view || typeof view.id !== 'string' || !view.box ||
        ![view.x, view.y, view.scale, view.box.minX, view.box.minY, view.box.width, view.box.height].every(Number.isFinite) || view.scale <= 0 ||
        !Array.isArray(view.visiblePaths) || !Array.isArray(view.hiddenPaths) ||
        ![...view.visiblePaths, ...view.hiddenPaths].every(p => typeof p === 'string') || !Array.isArray(view.lineEdges))
        throw new Error('Vista de desenho inválida.');
    }
  }
  return doc.sheets;
}

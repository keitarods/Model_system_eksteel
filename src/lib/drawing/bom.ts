import type { Solid } from "replicad";
import {
  convertArea,
  convertVolume,
  measurePhysicalProperties,
  AREA_UNIT_LABELS,
  DEFAULT_AREA_UNIT,
  DEFAULT_VOLUME_UNIT,
  VOLUME_UNIT_LABELS,
  type AreaUnit,
  type VolumeUnit,
} from "@/lib/replicad/physicalProperties";
import type { ComponentInstance } from "@/lib/assembly/types";
import { createEmptyPartProperties, type PartProperties } from "@/lib/project/partProperties";
import { createId } from "@/lib/sketch/render";

// Lista de Peças (BOM / Parts List) de uma MONTAGEM, ao estilo Inventor:
// uma tabela na folha de desenho, com uma linha por peça distinta, quantidade
// agrupada, e colunas configuráveis que puxam ou as "iProperties" da peça
// (código/descrição/material/responsável — ver partProperties.ts) ou uma
// VARIÁVEL GEOMÉTRICA calculada do sólido dela (comprimento/largura/altura
// da caixa envolvente, volume, área, massa).
//
// Assim como o Inventor, as linhas são um SNAPSHOT: geradas ao inserir a
// lista (ou ao clicar "Atualizar Lista") e depois editáveis célula a célula
// — quem quiser corrigir um texto na lista sem mexer na peça consegue, e
// quem quiser os valores de volta em dia clica em atualizar. `overrides`
// guarda só as células editadas à mão, pra que uma atualização recalcule os
// valores automáticos SEM apagar o que foi escrito manualmente.

export type BomColumnKey =
  | "item"
  | "quantity"
  | "partNumber"
  | "description"
  | "material"
  | "length"
  | "width"
  | "height"
  | "mass"
  | "volume"
  | "area"
  | "designer"
  | "engineer"
  | "vendor"
  | "notes"
  | "custom";

export type BomColumn = {
  key: BomColumnKey;
  // Cabeçalho impresso — editável (cada empresa/norma nomeia diferente:
  // "ITEM"/"POS.", "QTD"/"QT.", "DESCRIÇÃO"/"DENOMINAÇÃO"...).
  label: string;
  // Largura em mm na folha.
  width: number;
  align: "left" | "center" | "right";
  // Só pra key "custom": distingue duas colunas livres diferentes na mesma
  // tabela (senão as duas leriam/escreveriam o mesmo override).
  customId?: string;
  // Unidade de apresentação — só pras colunas "area" e "volume". A medição
  // guardada é sempre em mm²/mm³ (ver BomRow.metrics), então trocar aqui
  // reformata a coluna na hora, sem precisar recalcular a lista.
  areaUnit?: AreaUnit;
  volumeUnit?: VolumeUnit;
};

// Medições BRUTAS da peça (sempre em mm/mm²/mm³/kg), guardadas junto da
// linha pra que trocar a unidade de uma coluna reformate na hora — sem
// isso, mudar de cm² pra m² só teria efeito no próximo "Atualizar Lista",
// o que parece um bug pra quem mexeu no seletor e não viu nada mudar.
// Opcional: linhas de arquivos salvos antes disso caem no texto já
// formatado em `values`.
export type BomRowMetrics = {
  volumeMm3?: number;
  areaMm2?: number;
};

export type BomRow = {
  id: string;
  // Instâncias da montagem que essa linha representa (mais de uma quando a
  // mesma peça aparece repetida — é daí que sai a QUANTIDADE).
  instanceIds: string[];
  // Valores calculados na última geração/atualização, já formatados.
  values: Partial<Record<string, string>>;
  // Células editadas à mão — têm prioridade sobre `values` na hora de
  // desenhar, e sobrevivem a um "Atualizar Lista".
  overrides: Partial<Record<string, string>>;
  metrics?: BomRowMetrics;
};

export type BomTable = {
  id: string;
  // Canto da tabela na folha (mm). Qual canto depende de `growUp`: com
  // growUp (padrão, igual Inventor) esse é o canto INFERIOR esquerdo e a
  // tabela cresce pra cima a partir dele — assim ela pode ficar encostada
  // em cima do bloco de título sem invadir ele conforme ganha linhas.
  x: number;
  y: number;
  title: string;
  columns: BomColumn[];
  rows: BomRow[];
  rowHeight: number;
  headerHeight: number;
  fontSize: number;
  growUp: boolean;
};

// Chave de célula: a própria key da coluna, exceto pras colunas livres
// (custom), que usam o customId pra não colidirem entre si.
export function cellKey(column: BomColumn): string {
  return column.key === "custom" ? `custom:${column.customId ?? ""}` : column.key;
}

export function cellValue(row: BomRow, column: BomColumn): string {
  const key = cellKey(column);
  const override = row.overrides[key];
  if (override !== undefined) return override;

  // Área e volume são formatados AQUI (não na geração da lista) a partir da
  // medição bruta, pra que trocar a unidade da coluna tenha efeito
  // imediato. Sem `metrics` (linha de arquivo antigo) cai no texto já
  // formatado que ficou salvo.
  if (column.key === "area" && row.metrics?.areaMm2 !== undefined) {
    return convertArea(row.metrics.areaMm2, column.areaUnit ?? DEFAULT_AREA_UNIT);
  }
  if (column.key === "volume" && row.metrics?.volumeMm3 !== undefined) {
    return convertVolume(row.metrics.volumeMm3, column.volumeUnit ?? DEFAULT_VOLUME_UNIT);
  }

  return row.values[key] ?? "";
}

// Rótulo padrão da coluna, já com a unidade escolhida — as colunas de área
// e volume trazem a unidade no cabeçalho ("ÁREA (m²)"), então trocar a
// unidade tem que poder atualizar o cabeçalho junto.
export function defaultColumnLabel(column: Pick<BomColumn, "key" | "areaUnit" | "volumeUnit">): string {
  if (column.key === "area") return `ÁREA (${AREA_UNIT_LABELS[column.areaUnit ?? DEFAULT_AREA_UNIT]})`;
  if (column.key === "volume") return `VOLUME (${VOLUME_UNIT_LABELS[column.volumeUnit ?? DEFAULT_VOLUME_UNIT]})`;
  return BOM_COLUMN_LABELS[column.key];
}

// Colunas padrão — mesma espinha dorsal da Parts List do Inventor (ITEM /
// QTD / Nº DA PEÇA / DESCRIÇÃO), acrescida do que uma serralheria olha
// primeiro numa lista de corte: material, comprimento e massa.
export const DEFAULT_BOM_COLUMNS: BomColumn[] = [
  { key: "item", label: "ITEM", width: 12, align: "center" },
  { key: "quantity", label: "QTD", width: 12, align: "center" },
  { key: "partNumber", label: "Nº DA PEÇA", width: 38, align: "left" },
  { key: "description", label: "DESCRIÇÃO", width: 50, align: "left" },
  { key: "material", label: "MATERIAL", width: 32, align: "left" },
  { key: "length", label: "COMP. (mm)", width: 20, align: "right" },
  { key: "mass", label: "MASSA (kg)", width: 20, align: "right" },
];

// Rótulo padrão de cada coluna disponível — usado pelo seletor de colunas
// (adicionar coluna) e como fallback ao normalizar tabelas salvas.
export const BOM_COLUMN_LABELS: Record<BomColumnKey, string> = {
  item: "ITEM",
  quantity: "QTD",
  partNumber: "Nº DA PEÇA",
  description: "DESCRIÇÃO",
  material: "MATERIAL",
  length: "COMP. (mm)",
  width: "LARG. (mm)",
  height: "ALT. (mm)",
  mass: "MASSA (kg)",
  volume: "VOLUME (cm³)",
  area: "ÁREA (cm²)",
  designer: "DESENHISTA",
  engineer: "ENGENHEIRO",
  vendor: "FORNECEDOR",
  notes: "OBSERVAÇÕES",
  custom: "COLUNA LIVRE",
};

// Largura padrão sugerida ao acrescentar cada tipo de coluna (mm) — texto
// livre precisa de mais espaço que número.
const DEFAULT_COLUMN_WIDTH: Record<BomColumnKey, number> = {
  item: 12,
  quantity: 12,
  partNumber: 38,
  description: 50,
  material: 32,
  length: 20,
  width: 20,
  height: 20,
  mass: 20,
  volume: 22,
  area: 22,
  designer: 28,
  engineer: 28,
  vendor: 30,
  notes: 40,
  custom: 30,
};

const NUMERIC_KEYS: BomColumnKey[] = ["length", "width", "height", "mass", "volume", "area"];

export function createBomColumn(key: BomColumnKey): BomColumn {
  const units =
    key === "area" ? { areaUnit: DEFAULT_AREA_UNIT } : key === "volume" ? { volumeUnit: DEFAULT_VOLUME_UNIT } : {};
  return {
    key,
    label: defaultColumnLabel({ key, ...units }),
    width: DEFAULT_COLUMN_WIDTH[key],
    align: key === "item" || key === "quantity" ? "center" : NUMERIC_KEYS.includes(key) ? "right" : "left",
    ...(key === "custom" ? { customId: createId() } : {}),
    ...units,
  };
}

export function bomTableWidth(table: BomTable): number {
  return table.columns.reduce((sum, c) => sum + c.width, 0);
}

export function bomTableHeight(table: BomTable): number {
  return table.headerHeight + table.rows.length * table.rowHeight;
}

// Canto SUPERIOR esquerdo, já resolvendo o sentido de crescimento — todo o
// desenho da tabela parte daqui (ver BomTableSvg em DrawingSheetWorkspace).
export function bomTableTopLeft(table: BomTable): { x: number; y: number } {
  return { x: table.x, y: table.growUp ? table.y - bomTableHeight(table) : table.y };
}

// --- Cálculo das linhas a partir da montagem ---------------------------

// Uma peça da montagem, já resolvida: instância + sólido reconstruído +
// iProperties lidas do arquivo dela. `solid` pode ser null quando a peça
// está sem vínculo (arquivo perdido) — a linha entra na lista mesmo assim,
// só sem as variáveis geométricas, pra não sumir uma peça da lista por
// causa de um vínculo quebrado.
export type BomSourcePart = {
  instance: ComponentInstance;
  solid: Solid | null;
  properties: PartProperties;
};

function formatNumber(value: number, decimals: number): string {
  if (!Number.isFinite(value)) return "";
  // Vírgula decimal (pt-BR) — a folha inteira é em português e uma lista de
  // peças com "12.5" no meio de cotas em "12,5" fica visivelmente
  // inconsistente.
  return value.toFixed(decimals).replace(".", ",");
}

// Assinatura de agrupamento: duas instâncias viram UMA linha (com
// quantidade 2) quando apontam pro mesmo arquivo de peça — mesmo critério
// do Inventor, que agrupa por documento referenciado, não por nome de
// ocorrência. linkKey é o identificador estável do vínculo (ver
// linkedFiles.ts); o nº da peça entra junto porque duas cópias do MESMO
// arquivo com códigos diferentes preenchidos à mão não deveriam se fundir.
function groupKeyOf(part: BomSourcePart): string {
  return `${part.instance.linkKey}::${part.properties.partNumber}`;
}

// Gera as linhas da lista a partir das peças da montagem. Peças suprimidas
// ficam de fora (igual Inventor: componente suprimido não entra na lista).
export function computeBomRows(parts: BomSourcePart[]): BomRow[] {
  const groups = new Map<string, BomSourcePart[]>();
  for (const part of parts) {
    if (part.instance.suppressed) continue;
    const key = groupKeyOf(part);
    const existing = groups.get(key);
    if (existing) existing.push(part);
    else groups.set(key, [part]);
  }

  return [...groups.values()].map((group, index) => {
    const first = group[0];
    const { properties, solid } = first;
    const values: Record<string, string> = {
      item: String(index + 1),
      quantity: String(group.length),
      // Sem código preenchido, o nome do arquivo (sem extensão) é o
      // identificador mais útil que existe — é como a peça aparece na
      // árvore da montagem.
      partNumber: properties.partNumber || first.instance.label,
      description: properties.description,
      material: properties.material,
      designer: properties.designer,
      engineer: properties.engineer,
      vendor: properties.vendor,
      notes: properties.notes,
    };

    let metrics: BomRowMetrics | undefined;
    if (solid) {
      // Mesma medição usada no painel de Propriedades da peça e no total da
      // montagem — ver src/lib/replicad/physicalProperties.ts.
      const physical = measurePhysicalProperties(solid, properties.density);
      values.length = formatNumber(physical.length, 1);
      values.width = formatNumber(physical.width, 1);
      values.height = formatNumber(physical.height, 1);
      // volume/área ficam também em `metrics` (bruto, mm³/mm²): é de lá
      // que cellValue formata conforme a unidade escolhida na coluna.
      metrics = { volumeMm3: physical.volumeMm3, areaMm2: physical.areaMm2 };
      values.volume = convertVolume(physical.volumeMm3, DEFAULT_VOLUME_UNIT);
      values.area = convertArea(physical.areaMm2, DEFAULT_AREA_UNIT);
      // Massa da linha é a da peça UNITÁRIA (não × quantidade) — igual
      // Inventor, que tem "MASSA" por peça e deixa o total pra quem somar.
      if (physical.massKg !== null) values.mass = formatNumber(physical.massKg, 3);
    }

    return {
      id: createId(),
      instanceIds: group.map((p) => p.instance.id),
      values,
      overrides: {},
      metrics,
    };
  });
}

// Recalcula os valores automáticos preservando: a ordem/identidade das
// linhas que continuam existindo (pra não embaralhar itens já balonados no
// desenho) e TODAS as edições manuais. Linhas cuja peça saiu da montagem
// somem; peças novas entram no fim.
export function refreshBomRows(previous: BomRow[], parts: BomSourcePart[]): BomRow[] {
  const fresh = computeBomRows(parts);
  const byInstance = new Map<string, BomRow>();
  for (const row of fresh) {
    for (const id of row.instanceIds) byInstance.set(id, row);
  }

  const used = new Set<BomRow>();
  const kept: BomRow[] = [];
  for (const old of previous) {
    // Casa pela primeira instância que ainda exista — uma linha antiga
    // continua "a mesma" enquanto pelo menos uma das peças dela seguir na
    // montagem.
    const match = old.instanceIds.map((id) => byInstance.get(id)).find((r): r is BomRow => !!r && !used.has(r));
    if (!match) continue;
    used.add(match);
    kept.push({ ...old, instanceIds: match.instanceIds, values: match.values, metrics: match.metrics });
  }

  for (const row of fresh) {
    if (!used.has(row)) kept.push(row);
  }

  // Renumera o ITEM na ordem final (linhas removidas não deixam buraco).
  return kept.map((row, index) => ({ ...row, values: { ...row.values, item: String(index + 1) } }));
}

export function createBomTable(x: number, y: number, rows: BomRow[] = []): BomTable {
  return {
    id: createId(),
    x,
    y,
    title: "LISTA DE PEÇAS",
    columns: DEFAULT_BOM_COLUMNS.map((c) => ({ ...c })),
    rows,
    rowHeight: 6,
    headerHeight: 7,
    fontSize: 2.6,
    growUp: true,
  };
}

// Modelo de lista reutilizável entre folhas/projetos — só a "moldura"
// (colunas + medidas), nunca as linhas (essas são sempre da montagem
// específica). Viaja junto do SheetTemplate, ver templateFormat.ts.
export type BomTemplate = Pick<BomTable, "title" | "columns" | "rowHeight" | "headerHeight" | "fontSize" | "growUp">;

export function bomTemplateFrom(table: BomTable): BomTemplate {
  return {
    title: table.title,
    columns: table.columns.map((c) => ({ ...c })),
    rowHeight: table.rowHeight,
    headerHeight: table.headerHeight,
    fontSize: table.fontSize,
    growUp: table.growUp,
  };
}

// Normaliza uma tabela vinda de arquivo salvo — campos podem faltar em
// arquivos de versões anteriores, e uma coluna sem largura/rótulo quebraria
// o desenho da tabela inteira.
export function normalizeBomTable(raw: BomTable): BomTable {
  const base = createBomTable(raw?.x ?? 0, raw?.y ?? 0);
  const columns = Array.isArray(raw?.columns) && raw.columns.length > 0 ? raw.columns : base.columns;
  return {
    ...base,
    ...raw,
    columns: columns.map((c) => ({
      key: c.key,
      label: c.label ?? defaultColumnLabel(c),
      width: Number.isFinite(c.width) && c.width > 0 ? c.width : DEFAULT_COLUMN_WIDTH[c.key] ?? 20,
      align: c.align ?? "left",
      ...(c.customId ? { customId: c.customId } : {}),
      ...(c.key === "area" ? { areaUnit: c.areaUnit ?? DEFAULT_AREA_UNIT } : {}),
      ...(c.key === "volume" ? { volumeUnit: c.volumeUnit ?? DEFAULT_VOLUME_UNIT } : {}),
    })),
    rows: (Array.isArray(raw?.rows) ? raw.rows : []).map((r) => ({
      id: r.id ?? createId(),
      instanceIds: Array.isArray(r.instanceIds) ? r.instanceIds : [],
      values: r.values ?? {},
      overrides: r.overrides ?? {},
      metrics: r.metrics,
    })),
  };
}

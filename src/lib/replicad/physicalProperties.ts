import { measureArea, measureVolume, type Shape3D } from "replicad";

// Propriedades físicas medidas do sólido, ao estilo da aba "Physical" das
// iProperties do Inventor: volume/área/massa e a caixa envolvente. Medir
// isso passa pelo OpenCascade e não é de graça, então NUNCA roda sozinho a
// cada alteração — é sempre disparado por um "Atualizar" explícito, igual o
// botão Update do Inventor (que também deixa o valor "velho" na tela até
// alguém mandar recalcular).

export type PhysicalProperties = {
  volumeMm3: number;
  areaMm2: number;
  // null = densidade desconhecida (0 nas iProperties da peça) — a massa
  // aparece como "—" em vez de zero, que seria uma informação errada.
  massKg: number | null;
  // Caixa envolvente, em mm.
  length: number;
  width: number;
  height: number;
};

// Caixa envolvente ORIENTADA AOS EIXOS do próprio sólido (espaço local da
// peça). Convenção: comprimento = maior dos três, altura = menor, largura =
// o do meio. Sem ordenar, a mesma peça modelada com o eixo pra outro lado
// apareceria com comprimento e altura trocados na lista de peças, o que
// confunde na hora de comprar/cortar.
export function boundingDimensions(solid: Shape3D): { length: number; width: number; height: number } {
  const bbox = solid.boundingBox;
  const dims = [bbox.width, bbox.height, bbox.depth].sort((a, b) => b - a);
  return { length: dims[0], width: dims[1], height: dims[2] };
}

export function measurePhysicalProperties(solid: Shape3D, density: number): PhysicalProperties {
  // measureVolume/measureArea devolvem em mm³/mm² (todo o app trabalha em mm).
  const volumeMm3 = measureVolume(solid);
  const { length, width, height } = boundingDimensions(solid);
  return {
    volumeMm3,
    areaMm2: measureArea(solid),
    // mm³ -> m³ (1e-9) e depois × kg/m³ = kg.
    massKg: density > 0 ? volumeMm3 * 1e-9 * density : null,
    length,
    width,
    height,
  };
}

// --- Montagem ----------------------------------------------------------

// Entrada mínima pra somar a massa de uma montagem — uma linha por
// COMPONENTE já resolvido (sólido + densidade do material dele). Quem monta
// isso é o AssemblyWorkspace, a partir dos sólidos reconstruídos e das
// iProperties lidas de cada peça vinculada.
export type AssemblyMassPart = {
  // Identidade da PEÇA (não da ocorrência) — duas instâncias com a mesma
  // chave são a mesma peça e viram uma linha só, com quantidade. Agrupar
  // pelo rótulo seria errado: dois arquivos diferentes podem ter o mesmo
  // nome, e aí a massa do primeiro valeria pra todos.
  key: string;
  label: string;
  solid: Shape3D | null;
  density: number;
};

export type AssemblyComponentMass = {
  label: string;
  quantity: number;
  unitMassKg: number | null;
  subtotalMassKg: number | null;
  unitVolumeMm3: number;
};

export type AssemblyPhysicalProperties = {
  components: AssemblyComponentMass[];
  totalMassKg: number;
  totalVolumeMm3: number;
  // Peças que entraram na conta de volume mas NÃO na de massa (sem
  // densidade, ou sem sólido resolvido) — a UI avisa que o total está
  // incompleto em vez de mostrar um número que parece exato e não é.
  partsWithoutMass: number;
};

// Soma a massa da montagem inteira, agrupando componentes iguais (mesmo
// rótulo) só pra exibição — o total é sempre a soma de TODAS as ocorrências.
export function measureAssemblyProperties(parts: AssemblyMassPart[]): AssemblyPhysicalProperties {
  const groups = new Map<string, { label: string; quantity: number; unitMassKg: number | null; unitVolumeMm3: number }>();

  for (const part of parts) {
    const existing = groups.get(part.key);
    if (existing) {
      existing.quantity += 1;
      continue;
    }
    // Sem sólido = vínculo não resolvido (arquivo perdido/permissão
    // negada): entra na lista pra ficar VISÍVEL que falta, mas com massa
    // nula, e conta em partsWithoutMass.
    const props = part.solid ? measurePhysicalProperties(part.solid, part.density) : null;
    groups.set(part.key, {
      label: part.label,
      quantity: 1,
      unitMassKg: props?.massKg ?? null,
      unitVolumeMm3: props?.volumeMm3 ?? 0,
    });
  }

  const components: AssemblyComponentMass[] = [...groups.values()].map((g) => ({
    label: g.label,
    quantity: g.quantity,
    unitMassKg: g.unitMassKg,
    subtotalMassKg: g.unitMassKg === null ? null : g.unitMassKg * g.quantity,
    unitVolumeMm3: g.unitVolumeMm3,
  }));

  return {
    components,
    totalMassKg: components.reduce((sum, c) => sum + (c.subtotalMassKg ?? 0), 0),
    totalVolumeMm3: components.reduce((sum, c) => sum + c.unitVolumeMm3 * c.quantity, 0),
    // Conta uma vez por OCORRÊNCIA sem massa, não por grupo — 3 cópias da
    // mesma peça sem densidade são 3 peças faltando no total.
    partsWithoutMass: components
      .filter((c) => c.subtotalMassKg === null)
      .reduce((sum, c) => sum + c.quantity, 0),
  };
}

// --- Unidades ----------------------------------------------------------

// Toda medição interna é sempre em mm/mm²/mm³ (o app inteiro trabalha em
// mm) — a unidade é só de APRESENTAÇÃO, escolhida por quem está olhando.
// Uma chapa de serralheria faz sentido em cm², mas uma estrutura inteira
// pede m², e um detalhe usinado pede mm² — daí a troca ser por painel/
// coluna, não uma configuração global do app.
export type AreaUnit = "mm2" | "cm2" | "m2";
export type VolumeUnit = "mm3" | "cm3" | "m3";

// Divisor pra converter de mm²/mm³ + quantas casas decimais fazem sentido
// nessa unidade (em m² um perfil pequeno vira 0,0460 — sem casas o valor
// sumiria em "0,0").
const AREA_UNITS: Record<AreaUnit, { divisor: number; decimals: number; label: string }> = {
  mm2: { divisor: 1, decimals: 0, label: "mm²" },
  cm2: { divisor: 100, decimals: 1, label: "cm²" },
  m2: { divisor: 1_000_000, decimals: 4, label: "m²" },
};

const VOLUME_UNITS: Record<VolumeUnit, { divisor: number; decimals: number; label: string }> = {
  mm3: { divisor: 1, decimals: 0, label: "mm³" },
  cm3: { divisor: 1_000, decimals: 1, label: "cm³" },
  m3: { divisor: 1_000_000_000, decimals: 6, label: "m³" },
};

export const AREA_UNIT_LABELS: Record<AreaUnit, string> = {
  mm2: AREA_UNITS.mm2.label,
  cm2: AREA_UNITS.cm2.label,
  m2: AREA_UNITS.m2.label,
};

export const VOLUME_UNIT_LABELS: Record<VolumeUnit, string> = {
  mm3: VOLUME_UNITS.mm3.label,
  cm3: VOLUME_UNITS.cm3.label,
  m3: VOLUME_UNITS.m3.label,
};

export const DEFAULT_AREA_UNIT: AreaUnit = "cm2";
export const DEFAULT_VOLUME_UNIT: VolumeUnit = "cm3";

// Formatação em pt-BR (vírgula decimal) — a folha e os painéis inteiros são
// em português, e "1.57 kg" no meio de cotas "12,5" fica inconsistente.
export function formatNumberPtBr(value: number, decimals: number): string {
  if (!Number.isFinite(value)) return "—";
  return value.toFixed(decimals).replace(".", ",");
}

// Só o número convertido (sem a unidade junto) — usado nas colunas da lista
// de peças, onde a unidade já está escrita no cabeçalho da coluna.
export function convertArea(areaMm2: number, unit: AreaUnit): string {
  const { divisor, decimals } = AREA_UNITS[unit];
  return formatNumberPtBr(areaMm2 / divisor, decimals);
}

export function convertVolume(volumeMm3: number, unit: VolumeUnit): string {
  const { divisor, decimals } = VOLUME_UNITS[unit];
  return formatNumberPtBr(volumeMm3 / divisor, decimals);
}

// Número + unidade — usado nos painéis de propriedades, onde não há
// cabeçalho de coluna dizendo a unidade.
export function formatArea(areaMm2: number, unit: AreaUnit): string {
  return `${convertArea(areaMm2, unit)} ${AREA_UNITS[unit].label}`;
}

export function formatVolume(volumeMm3: number, unit: VolumeUnit): string {
  return `${convertVolume(volumeMm3, unit)} ${VOLUME_UNITS[unit].label}`;
}

export function formatMass(massKg: number | null): string {
  if (massKg === null) return "—";
  // Peças pequenas em kg ficariam "0,000" — abaixo de 1 kg mostra em
  // gramas, que é como uma serralheria fala de parafuso/chapinha.
  if (massKg < 1) return `${formatNumberPtBr(massKg * 1000, 1)} g`;
  return `${formatNumberPtBr(massKg, 3)} kg`;
}

import type { SketchTool } from "./types";

// Metadados puros das ferramentas de sketch — sem ícones (React), pra poder
// ser importado tanto pela lógica de interação (store) quanto por qualquer
// UI que precise desenhar uma paleta (2D ou 3D). Atalhos inspirados em
// convenções comuns de CAD, não uma cópia garantida do keymap do Inventor.
export const SKETCH_TOOLS: { id: SketchTool; label: string; shortcut: string }[] = [
  { id: "select", label: "Selecionar", shortcut: "S" },
  { id: "line", label: "Linha", shortcut: "L" },
  { id: "centerline", label: "Linha de Centro", shortcut: "X" },
  { id: "rect", label: "Retângulo", shortcut: "R" },
  { id: "circle", label: "Círculo", shortcut: "C" },
  { id: "measure", label: "Medir", shortcut: "M" },
  { id: "dimension", label: "Cota", shortcut: "D" },
  { id: "point", label: "Ponto", shortcut: "P" },
  // Coincidente (ao estilo Inventor "Coincident Constraint"): clica 2
  // pontos (funde os dois) OU um ponto e uma linha (o ponto pula pra cima
  // da linha) — ver handleConstraintClick/makePointCoincidentWithLine em
  // sketch/store.ts.
  { id: "joinPoints", label: "Coincidente", shortcut: "J" },
  { id: "horizontal", label: "Horizontal", shortcut: "H" },
  { id: "vertical", label: "Vertical", shortcut: "V" },
  { id: "perpendicular", label: "Perpendicular", shortcut: "Q" },
  { id: "tangent", label: "Tangente", shortcut: "T" },
  { id: "fillet2d", label: "Concordância", shortcut: "F" },
  { id: "chamfer2d", label: "Chanfro", shortcut: "B" },
  { id: "slotCenterToCenter", label: "Rasgo (centro a centro)", shortcut: "G" },
  { id: "slotCenterPoint", label: "Rasgo (ponto central)", shortcut: "K" },
  { id: "projectGeometry", label: "Projetar Geometria", shortcut: "I" },
];

export const SHORTCUT_TO_TOOL: Record<string, SketchTool> = Object.fromEntries(
  SKETCH_TOOLS.map((t) => [t.shortcut.toLowerCase(), t.id])
);

// Seções da paleta, ao estilo dos painéis "Esboçar"/"Restringir" da ribbon
// do Inventor — cada uma com uma legenda visível (null = sem legenda, pros
// utilitários que não são nem construção nem restrição). A lista
// "achatada" SKETCH_TOOLS continua sendo a fonte de verdade dos atalhos.
// - Esboçar: cria geometria nova no sketch (linhas, formas, furos de
//   concordância/chanfro, projeção de aresta do sólido).
// - Restringir: não cria geometria — ou une/alinha a que já existe
//   (Unir Pontos = "Coincident" do Inventor, Horizontal/Vertical/
//   Perpendicular/Tangente), ou a COTA (que no Inventor mora no mesmo
//   painel "Constrain" — uma cota é, na prática, uma restrição de
//   tamanho).
export const TOOL_SECTIONS: { label: string | null; tools: SketchTool[] }[] = [
  { label: null, tools: ["select"] },
  {
    label: "Esboçar",
    tools: [
      "line",
      "centerline",
      "rect",
      "circle",
      "point",
      "slotCenterToCenter",
      "slotCenterPoint",
      "fillet2d",
      "chamfer2d",
      "projectGeometry",
    ],
  },
  {
    label: "Restringir",
    tools: ["joinPoints", "horizontal", "vertical", "perpendicular", "tangent", "dimension"],
  },
  { label: null, tools: ["measure"] },
];

// Ferramentas de arrasto (baixo → mover → soltar desenha/mede).
export const DRAG_TOOLS = new Set<SketchTool>([
  "line",
  "centerline",
  "rect",
  "circle",
  "measure",
  "dimension",
]);

// Ferramentas de clique único/duplo-clique (sem arrasto) — aplicam a
// mudança na hora, ao estilo dos constraints de um clique só do Inventor.
export const CLICK_TOOLS = new Set<SketchTool>([
  "point",
  "horizontal",
  "vertical",
  "perpendicular",
  "tangent",
  "joinPoints",
  "fillet2d",
  "chamfer2d",
  "projectGeometry",
]);

// Rasgo: híbrido clique+clique+arrasto (2 pontos definem o eixo/espelho,
// o 3º passo — arrasto — define o raio) — não se encaixa nem em
// DRAG_TOOLS (só 1 arrasto) nem em CLICK_TOOLS (nenhum arrasto), por isso
// tem um conjunto próprio, tratado à parte em handleRawDown/Move/Up.
export const SLOT_TOOLS = new Set<SketchTool>(["slotCenterToCenter", "slotCenterPoint"]);

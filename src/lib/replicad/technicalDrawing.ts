import { drawProjection, makeProjectedEdges, lookFromPlane, ProjectionCamera } from "replicad";
import type { AnyShape, Drawing, ProjectionPlane } from "replicad";
import type { DrawingView, ViewBoxRect, ViewOrientation } from "@/lib/drawing/types";
import { createId } from "@/lib/sketch/render";

// As 6 orientações padrão batem 1:1 com ProjectionPlane do replicad — "iso"
// não existe como plano nomeado, vira uma câmera customizada olhando de
// [1,-1,1] (mesmo ângulo isométrico já usado nos VIEW_PRESETS do viewer
// 3D), auto-enquadrada via .lookAt(shape).
const ORIENTATION_TO_PLANE: Record<Exclude<ViewOrientation, "iso">, ProjectionPlane> = {
  front: "front",
  back: "back",
  top: "top",
  bottom: "bottom",
  left: "left",
  right: "right",
};

// toSVGPaths() devolve string[] (Blueprint) OU string[][] (Blueprints,
// quando a projeção tem múltiplos contornos desconexos) — achata pro caso
// uniforme que a folha de desenho usa (uma lista plana de "d" pra
// desenhar, sem precisar diferenciar contorno por contorno).
function flattenPaths(paths: string[] | string[][]): string[] {
  if (paths.length === 0) return [];
  return Array.isArray(paths[0]) ? (paths as string[][]).flat() : (paths as string[]);
}

// "minX minY width height" — mesmo formato que toSVGViewBox(0) devolve,
// parseado pra número (evita reimplementar o cálculo de bounding box em
// espaço SVG, que já leva em conta o espelhamento Y que o replicad faz
// internamente ao serializar pra SVG — ver toSVGPathD(), que espelha antes
// de gerar o "d").
function parseViewBox(viewBoxAttr: string): ViewBoxRect {
  const [minX, minY, width, height] = viewBoxAttr.trim().split(/\s+/).map(Number);
  return { minX, minY, width, height };
}

function unionViewBox(a: ViewBoxRect, b: ViewBoxRect): ViewBoxRect {
  const minX = Math.min(a.minX, b.minX);
  const minY = Math.min(a.minY, b.minY);
  const maxX = Math.max(a.minX + a.width, b.minX + b.width);
  const maxY = Math.max(a.minY + a.height, b.minY + b.height);
  return { minX, minY, width: maxX - minX, height: maxY - minY };
}

// Só usado quando NEM a projeção visível nem a oculta têm nenhuma aresta
// (peça vazia/degenerada) — não deveria acontecer na prática, mas evita
// dividir por zero na hora de auto-escalar a vista na folha.
const EMPTY_BOX: ViewBoxRect = { minX: 0, minY: 0, width: 1, height: 1 };

function drawingBox(drawing: Drawing): ViewBoxRect | null {
  const paths = flattenPaths(drawing.toSVGPaths());
  if (paths.length === 0) return null;
  return parseViewBox(drawing.toSVGViewBox(0));
}

// Câmera de projeção pra uma orientação — sempre uma ProjectionCamera de
// verdade (não só o nome do plano): drawProjection() aceita os dois, mas
// makeProjectedEdges() (usado logo abaixo pra extrair as arestas retas
// clicáveis) exige a câmera já construída — resolver aqui garante que as 2
// chamadas usam EXATAMENTE a mesma câmera, sem risco de nome de plano vs.
// câmera equivalente divergirem por algum arredondamento.
function cameraFor(shape: AnyShape, orientation: ViewOrientation): ProjectionCamera {
  if (orientation === "iso") {
    return new ProjectionCamera([1, -1, 1]).lookAt(shape);
  }
  return lookFromPlane(ORIENTATION_TO_PLANE[orientation]);
}

// edge.startPoint/endPoint (depois do HLR) já vêm no referencial 2D da
// própria câmera (X/Y = plano de vista, Z = profundidade descartável) —
// numericamente iguais às coordenadas PRÉ-espelho que toSVGPathD() usa
// antes de espelhar em Y pra virar SVG (ver mirror([1,0],[0,0],"plane") em
// Blueprint.toSVGPathD, replicad.js). Por isso só falta negar Y aqui — nada
// de projeção manual contra xAxis/yAxis da câmera, e nada de reaproveitar
// o Z (é só a profundidade que a projeção já achatou).
function extractLineEdges(shape: AnyShape, camera: ProjectionCamera): { x1: number; y1: number; x2: number; y2: number }[] {
  const { visible, hidden } = makeProjectedEdges(shape, camera, true);
  const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (const edge of [...visible, ...hidden]) {
    if (edge.geomType === "LINE") {
      const p0 = edge.startPoint;
      const p1 = edge.endPoint;
      lines.push({ x1: p0.x, y1: -p0.y, x2: p1.x, y2: -p1.y });
    }
    edge.delete();
  }
  return lines;
}

// Gera uma DrawingView nova (HLR de verdade via OpenCascade, através de
// drawProjection do replicad) — chamada só ao criar a vista ou trocar
// orientação/planificado/dobrado (é cara, não roda a cada render). `shape`
// já deve ser o sólido certo pra essa vista (bent ou flat, resolvido por
// quem chama via rebuildModel({flatten}) — ver technicalDrawing não sabe
// nada sobre Feature[]/rebuildModel de propósito, só projeta o que
// receber).
export function buildDrawingView(
  shape: AnyShape,
  orientation: ViewOrientation,
  flattened: boolean,
  options: { x?: number; y?: number; scale?: number; label?: string } = {}
): DrawingView {
  const camera = cameraFor(shape, orientation);
  const { visible, hidden } = drawProjection(shape, camera);

  const visiblePaths = flattenPaths(visible.toSVGPaths());
  const hiddenPaths = flattenPaths(hidden.toSVGPaths());

  const vBox = drawingBox(visible);
  const hBox = drawingBox(hidden);
  const box = vBox && hBox ? unionViewBox(vBox, hBox) : vBox ?? hBox ?? EMPTY_BOX;

  const lineEdges = extractLineEdges(shape, camera);

  return {
    id: createId(),
    orientation,
    flattened,
    x: options.x ?? 0,
    y: options.y ?? 0,
    scale: options.scale ?? 1,
    scaleLabel: scaleToLabel(options.scale ?? 1),
    label: options.label ?? "",
    visiblePaths,
    hiddenPaths,
    box,
    lineEdges,
  };
}

// Texto "1:2" / "2:1" / "1:1" a partir do fator de escala — arredonda pra
// uma fração "redonda" das mais comuns em desenho técnico; se não bater
// exato com nenhuma, mostra o fator decimal direto (ex. "0.75:1").
const COMMON_SCALES: { factor: number; label: string }[] = [
  { factor: 1 / 20, label: "1:20" },
  { factor: 1 / 10, label: "1:10" },
  { factor: 1 / 5, label: "1:5" },
  { factor: 1 / 2, label: "1:2" },
  { factor: 1, label: "1:1" },
  { factor: 2, label: "2:1" },
  { factor: 5, label: "5:1" },
  { factor: 10, label: "10:1" },
];

export function scaleToLabel(factor: number): string {
  const match = COMMON_SCALES.find((s) => Math.abs(s.factor - factor) < 1e-6);
  if (match) return match.label;
  return factor >= 1 ? `${round2(factor)}:1` : `1:${round2(1 / factor)}`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// Maior escala "redonda" (da lista acima) que ainda cabe a projeção inteira
// dentro de maxWidth x maxHeight (mm, já com folga descontada por quem
// chama) — usado pra sugerir uma escala inicial sensata ao adicionar uma
// vista na folha, em vez de sempre começar em 1:1 (que pode estourar a
// folha pra peças grandes, ou ficar minúsculo pra peças pequenas).
export function suggestScale(box: ViewBoxRect, maxWidth: number, maxHeight: number): number {
  if (box.width <= 0 || box.height <= 0) return 1;
  const fitFactor = Math.min(maxWidth / box.width, maxHeight / box.height);
  const fitting = COMMON_SCALES.filter((s) => s.factor <= fitFactor);
  if (fitting.length === 0) return COMMON_SCALES[0].factor;
  return fitting[fitting.length - 1].factor;
}

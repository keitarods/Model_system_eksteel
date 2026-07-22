// Folha de desenho técnico 2D — gerada a partir da peça 3D atual (mesmo
// espírito do ambiente de Desenho do Inventor, só que dentro do mesmo
// projeto/arquivo em vez de um .idw separado vinculado ao .ipt; ver
// nativeFormat.ts). Cada DrawingView guarda uma projeção JÁ CALCULADA
// (snapshot das linhas visíveis/ocultas, não recalculada a cada render) —
// recalcular é caro (HLR de verdade via OpenCascade), então só acontece ao
// criar a vista ou trocar orientação/planificado/dobrado.

export type SheetSize = "A4" | "A3";
export type SheetOrientation = "landscape" | "portrait";

// "iso" não é um plano padrão do replicad — vira uma ProjectionCamera
// customizada (ver technicalDrawing.ts). As outras 6 batem 1:1 com
// ProjectionPlane do replicad.
export type ViewOrientation = "front" | "back" | "top" | "bottom" | "left" | "right" | "iso";

export const VIEW_ORIENTATION_LABELS: Record<ViewOrientation, string> = {
  front: "Frontal",
  back: "Posterior",
  top: "Superior",
  bottom: "Inferior",
  left: "Esquerda",
  right: "Direita",
  iso: "Isométrica",
};

// Retângulo em coordenadas SVG (mm, Y pra baixo — mesma convenção que
// toSVGPathD()/toSVGViewBox() do replicad já devolvem, sem flip manual
// necessário) que envolve a projeção inteira (visível ∪ oculta) — usado só
// pra centralizar/escalar a vista na folha, não é desenhado.
export type ViewBoxRect = { minX: number; minY: number; width: number; height: number };

export type DrawingView = {
  id: string;
  orientation: ViewOrientation;
  // Só relevante quando a peça tem uma feature de chapa (SheetMetalFeature)
  // na árvore — planificada usa rebuildModel({flatten:true}), dobrada usa
  // rebuildModel({flatten:false}). Ignorado (sempre como se fosse false)
  // pra peças sem chapa.
  flattened: boolean;
  // Posição do CENTRO da vista na folha (mm, origem no canto superior
  // esquerdo da folha, Y pra baixo — mesma convenção da folha inteira).
  x: number;
  y: number;
  // Fator de escala aplicado em cima do tamanho real (mm) da projeção —
  // 0.5 = "1:2", 2 = "2:1" etc. scaleLabel é só o texto mostrado (calculado
  // a partir de scale, mas guardado à parte pra escalas "feias" tipo 1:2.5
  // ainda mostrarem um texto redondo).
  scale: number;
  scaleLabel: string;
  label: string;
  // Paths SVG "d" prontos (já na convenção Y-pra-baixo do SVG, ver
  // technicalDrawing.ts) — linha cheia (visível) e tracejada (oculta).
  visiblePaths: string[];
  hiddenPaths: string[];
  // Arestas RETAS da projeção (visíveis + ocultas juntas), com ponta a
  // ponta exatas — na MESMA convenção de coordenadas dos paths SVG acima
  // (escala 1:1, local à vista, Y pra baixo). Curvas (arco/elipse/spline)
  // ficam de fora por ora — só linha reta entra no clique-pra-cotar (igual
  // Inventor: clicar uma aresta reta cota o comprimento dela; clicar 2
  // arestas retas cota a distância entre as duas).
  lineEdges: { x1: number; y1: number; x2: number; y2: number }[];
  // Bounding box da projeção bruta (escala 1:1, antes de aplicar `scale`),
  // em coordenadas SVG — usado pra centralizar a vista em (x,y) e pra
  // calcular a escala "ajustar à folha" automaticamente.
  box: ViewBoxRect;
};

// Cota entre 2 pontos escolhidos numa vista — em coordenadas da FOLHA (mm,
// já contabilizando posição+escala da vista no momento da criação), não
// paramétrica de volta pro sólido 3D: é uma medida sobre uma projeção que
// já é ela mesma um retrato congelado da peça. Mover a vista depois NÃO
// move a cota (mesma limitação que colocar cota numa vista do Inventor
// depois de mover ela sem atualizar — aqui é deliberado pra v1, não um bug).
export type DrawingDimension = {
  id: string;
  viewId: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  // Distância (mm, com sinal) da linha de cota até o segmento medido, ao
  // longo da normal CANÔNICA (-dy,dx) desse segmento — sinal positivo é um
  // lado, negativo o outro, arrastável pelo usuário (ver DrawingSheetWorkspace).
  // O valor inicial já sai calculado pra cair "pra fora" da peça (heurística
  // baseada no centro da vista), mas depois de criada é só um número comum,
  // sem mágica — arrastar simplesmente muda ele.
  offset: number;
};

export type TitleBlockInfo = {
  partName: string;
  material: string;
  drawnBy: string;
  date: string;
  notes: string;
};

export type DrawingSheet = {
  id: string;
  name: string;
  size: SheetSize;
  orientation: SheetOrientation;
  views: DrawingView[];
  dimensions: DrawingDimension[];
  titleBlock: TitleBlockInfo;
};

// Dimensões físicas de cada tamanho de folha, em mm, sempre na orientação
// retrato — landscape troca width/height na hora de desenhar.
export const SHEET_SIZES_MM: Record<SheetSize, { width: number; height: number }> = {
  A4: { width: 210, height: 297 },
  A3: { width: 297, height: 420 },
};

export function sheetDimensionsMm(sheet: Pick<DrawingSheet, "size" | "orientation">): {
  width: number;
  height: number;
} {
  const base = SHEET_SIZES_MM[sheet.size];
  return sheet.orientation === "landscape"
    ? { width: base.height, height: base.width }
    : { width: base.width, height: base.height };
}

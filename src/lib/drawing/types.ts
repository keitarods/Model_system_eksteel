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
  // Assinatura da árvore de features (JSON.stringify(features)) no momento
  // em que essa vista foi gerada — comparada com a árvore ATUAL pra saber se
  // a vista ficou desatualizada (ver DrawingSheetWorkspace), igual o aviso
  // de "vista desatualizada" do Inventor. undefined = vista de um projeto
  // salvo antes dessa comparação existir — tratada como "não sinalizada"
  // por padrão (não fica marcada como desatualizada do nada ao reabrir um
  // projeto antigo).
  sourceSignature?: string;
  // Presente só em vistas de SEÇÃO DE CORTE — de onde ela veio (view "mãe")
  // e a linha de corte que a gerou, em coordenadas LOCAIS da vista mãe
  // (mesma convenção de lineEdges: escala 1:1, antes de x/y/scale) — usada
  // só pra desenhar o indicador da linha de corte de volta na vista mãe e
  // pra permitir "Atualizar" recalcular o mesmo corte depois de uma
  // alteração no 3D.
  sectionInfo?: SectionInfo;
};

export type SectionInfo = {
  baseViewId: string;
  letter: string;
  cutLine: { x1: number; y1: number; x2: number; y2: number };
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

// Anotações de simbologia comuns em desenho técnico — texto livre, chanfro
// e rosca são todas "clica um ponto, digita o texto" (mesmo formato
// visual, só muda o rótulo/placeholder da ferramenta e o ícone na barra);
// solda é a única que precisa de 2 pontos (ponta da seta apontando pra
// junta + posição da linha de referência), por isso tem seu próprio
// formato. Simplificado de propósito: não é o sistema completo de símbolos
// de solda da ISO 2553/AWS A2.4 (dezenas de tipos de junta, cauda,
// "all-around" etc.) — só o glifo de solda em filete (o mais comum) com
// texto de medida editável, que cobre a maioria do uso do dia a dia.
export type AnnotationKind = "text" | "chamfer" | "thread";

export type DrawingAnnotation =
  | { id: string; viewId: string | null; kind: AnnotationKind; x: number; y: number; text: string }
  | { id: string; viewId: string | null; kind: "weld"; x1: number; y1: number; x2: number; y2: number; text: string };

// Linha da tabelinha de "tolerâncias não especificadas" que fica à esquerda
// do bloco de título (ex.: "Chapas cortadas a laser e dobradas" → "m") —
// lista editável, não um enum fixo, porque cada empresa/norma tem a sua
// própria tabela (ver DEFAULT_TOLERANCE_ROWS pro padrão da Eksteel).
export type ToleranceRow = { label: string; code: string };

export const DEFAULT_TOLERANCE_ROWS: ToleranceRow[] = [
  { label: "Conjuntos medidos gerais", code: "m" },
  { label: "Conjuntos e detalhes soldados a laser", code: "c" },
  { label: "Chapas cortadas a laser e dobradas", code: "m" },
  { label: "Furos usinados", code: "f" },
  { label: "Tubos quadrados e retangulares, perfis cortados", code: "c" },
];

// Bloco de título completo, ao estilo do modelo padrão da Eksteel (tabela
// de tolerâncias + logo + campos + canto de revisão/página) — layout
// desenhado em TitleBlockSvg, campos editáveis em TitleBlockForm.
export type TitleBlockInfo = {
  partName: string;
  material: string;
  measurements: string;
  code: string;
  finish: string;
  processes: string;
  toleranceStandard: string;
  treatment: string;
  hardness: string;
  designer: string;
  approvedBy: string;
  weight: string;
  revision: string;
  revisionDate: string;
  page: string;
  toleranceRows: ToleranceRow[];
  // Logo da empresa embutido como data URL (base64) — sem backend de
  // arquivos separado, o jeito mais simples de "anexar uma imagem" que
  // ainda viaja inteiro dentro do próprio projeto/modelo salvo (.eks3d /
  // .eksfolha), sem depender de um caminho de arquivo externo que pode não
  // existir mais quando o projeto for reaberto em outra máquina.
  logoDataUrl: string | null;
};

export type DrawingSheet = {
  id: string;
  name: string;
  size: SheetSize;
  orientation: SheetOrientation;
  // Escala padrão da folha (ex.: 1 = "1:1") — usada como escala inicial de
  // toda vista NOVA colocada nela (Adicionar Vista / Inserir Vista / Seção
  // de Corte; Vista Projetada é a exceção, sempre herda a escala da vista-
  // base pra ficar alinhada com ela). Editável na barra da folha; mudar
  // aqui não reescala vistas já colocadas, só afeta as próximas — igual
  // "Escala da Folha" do Inventor.
  scale: number;
  views: DrawingView[];
  dimensions: DrawingDimension[];
  annotations: DrawingAnnotation[];
  titleBlock: TitleBlockInfo;
};

// "Modelo de folha" — só o que é reutilizável entre peças diferentes
// (tamanho/orientação + bloco de título, incluindo tabela de tolerâncias e
// logo), SEM vistas/cotas (essas são sempre específicas de uma peça). Salvo
// e carregado como arquivo próprio (ver templateFormat.ts) — mesmo espírito
// do .eks3d pra peças, só que pra padronizar a folha em vez do modelo 3D.
export type SheetTemplate = {
  size: SheetSize;
  orientation: SheetOrientation;
  scale: number;
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

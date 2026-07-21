export type Point = { x: number; y: number };

export type SketchTool =
  | "select"
  | "line"
  | "centerline"
  | "rect"
  | "circle"
  | "point"
  | "measure"
  | "dimension"
  | "joinPoints"
  | "horizontal"
  | "vertical"
  | "perpendicular"
  | "tangent"
  | "fillet2d"
  | "chamfer2d"
  // Rasgo oblongado (Inventor "Slot"), 2 variantes — mesmo shape resultante
  // (SlotShape), só muda como os 2 centros são definidos:
  // centerToCenter = clica os dois centros direto; centerPoint = clica o
  // ponto médio do rasgo inteiro e UMA extremidade — a outra é espelhada
  // automaticamente em torno do ponto médio.
  | "slotCenterToCenter"
  | "slotCenterPoint";

// Ponto compartilhado do sketch atual. Shapes referenciam pontos por id em
// vez de embutir coordenadas — é isso que dá a "coincidência de graça": duas
// arestas que compartilham um ponto se movem juntas quando a cota que
// controla esse ponto é editada.
export type SketchPoint = { id: string; x: number; y: number };

export type LineShape = {
  id: string;
  type: "line";
  p1: string;
  p2: string;
  // Linha de centro (eixo de revolução, ao estilo Inventor) — não entra na
  // detecção de contorno fechado de findProfileSource, é só referência.
  isCenterLine?: boolean;
};

export type RectShape = {
  id: string;
  type: "rect";
  p1: string; // cantos opostos
  p2: string;
};

export type CircleShape = {
  id: string;
  type: "circle";
  center: string;
  radius: number;
};

// Ponto solto (não é vértice de nenhuma linha/retângulo/círculo) — geometria
// de construção/referência, ao estilo "Create Point" do Inventor.
export type PointShape = {
  id: string;
  type: "point";
  pointId: string;
};

// Arco de concordância (fillet) entre duas linhas — sempre o arco MENOR
// (curto, <180°) entre p1 e p2, é assim que um canto arredondado sempre é
// geometricamente. Nasce só da ferramenta Fillet (substitui um canto vivo),
// não é uma ferramenta de desenho livre.
export type ArcShape = {
  id: string;
  type: "arc";
  p1: string;
  p2: string;
  center: string;
};

// Rasgo oblongado ("stadium"): dois arcos de 180° (raio igual) nos centros
// center1/center2, ligados por duas retas tangentes paralelas ao eixo
// center1→center2, deslocadas ±radius perpendicular a esse eixo. Mesmo
// shape final pras duas variantes da ferramenta (ver SketchTool) — só a
// forma de escolher center1/center2 muda, o resultado guardado é idêntico.
export type SlotShape = {
  id: string;
  type: "slot";
  center1: string;
  center2: string;
  radius: number;
};

export type SketchShape = LineShape | RectShape | CircleShape | PointShape | ArcShape | SlotShape;

// Referência a UMA aresta reta específica (não a forma inteira) — precisa
// desambiguar qual das 2 arestas paralelas de um retângulo/rasgo, já que
// nenhuma das duas tem um id de ponto próprio pros 2 cantos derivados (só
// p1/p2 do retângulo, ou center1/center2 do rasgo, são pontos de verdade).
// Resolvida sob demanda (não guarda coordenadas) — acompanha a forma se ela
// for editada depois, igual toda cota paramétrica.
export type EdgeRef =
  | { kind: "line"; lineId: string }
  | { kind: "rectEdge"; rectId: string; axis: "width" | "height"; edge: "p1" | "p2" }
  | { kind: "slotTangent"; slotId: string; side: 1 | -1 };

// Cota: "distance" liga dois pontos (editar arrasta p2 em relação a p1 ao
// longo da mesma direção); "radius" controla o raio de um círculo
// diretamente; "width"/"height" controlam só o x ou só o y de p2 em relação
// a p1 de um retângulo (um retângulo só guarda 2 cantos diagonais, não 4
// independentes — largura e altura precisam mexer em eixos separados, não
// dá pra usar "distance" genérico sem also distorcer a outra dimensão).
// Todas são paramétricas — mudar o valor recalcula a geometria.
export type DimensionAnnotation =
  | { id: string; kind: "distance"; p1: string; p2: string }
  | { id: string; kind: "radius"; circleId: string }
  | { id: string; kind: "width"; rectId: string }
  | { id: string; kind: "height"; rectId: string }
  // Raio de um arco de concordância — kind separado (não reaproveita
  // "radius") porque ArcShape não guarda raio próprio, é sempre derivado de
  // center/p1 (ver resolveDimension), então editar precisa mover p1/p2 em
  // vez de só trocar um campo .radius como no círculo.
  | { id: string; kind: "arcRadius"; arcId: string }
  // Raio (largura) de um rasgo — SlotShape guarda radius direto, igual
  // círculo, então updateSlotRadiusDimension é estruturalmente idêntico a
  // updateRadiusDimension. O comprimento do rasgo (eixo center1→center2)
  // não precisa de kind própria: é só uma "distance" comum entre os dois
  // centros, que já são pontos de verdade.
  | { id: string; kind: "slotRadius"; slotId: string }
  // Distância entre 2 arestas retas selecionadas (uma de cada vez, ao estilo
  // Inventor) — ex.: as 2 tangentes de um rasgo (dá a largura) ou as 2
  // arestas de largura de um retângulo (dá a altura, e vice-versa). Sempre
  // medida como a projeção do ponto médio de `a` na reta infinita de `b` —
  // exata quando paralelas, uma aproximação razoável quando não. Editar
  // mantém `a` parada e move só `b` (ver updateEdgeDistanceDimension em
  // store.ts / translateEdgeRef), mesmo espírito de updateDistanceDimension
  // manter p1 parado.
  | { id: string; kind: "edgeDistance"; a: EdgeRef; b: EdgeRef };

// Plano de trabalho do sketch ativo, em coordenadas de mundo. O padrão é o
// plano XY; ao iniciar um esboço sobre uma face do sólido existente, origin/
// normal vêm do ponto clicado no viewer 3D.
export type SketchPlane = {
  origin: [number, number, number];
  normal: [number, number, number];
  xDir: [number, number, number];
};

export const BASE_SKETCH_PLANE: SketchPlane = {
  origin: [0, 0, 0],
  normal: [0, 0, 1],
  xDir: [1, 0, 0],
};

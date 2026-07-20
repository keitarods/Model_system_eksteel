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
  | "chamfer2d";

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

export type SketchShape = LineShape | RectShape | CircleShape | PointShape | ArcShape;

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
  | { id: string; kind: "height"; rectId: string };

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

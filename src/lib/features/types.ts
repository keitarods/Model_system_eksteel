import type {
  DimensionAnnotation,
  Point,
  SketchPlane,
  SketchPoint,
  SketchShape,
} from "@/lib/sketch/types";
import type { ExtrudeDirection, ProfileSource } from "@/lib/replicad/geometry";

// Esboço salvo na árvore de histórico (ao estilo Inventor) — é só registro/
// reabertura; Extrudar/Revolucionar/Furo continuam lendo o sketch "ao vivo"
// (useSketchStore), não este snapshot. Reabrir um SketchFeature carrega os
// dados dele de volta pro sketch ao vivo pra continuar editando.
export type SketchFeature = {
  id: string;
  type: "sketch";
  label: string;
  plane: SketchPlane;
  shapes: SketchShape[];
  points: Record<string, SketchPoint>;
  dimensions: DimensionAnnotation[];
};

export type ExtrudeFeature = {
  id: string;
  type: "extrude";
  label: string;
  profile: NonNullable<ProfileSource>;
  plane: SketchPlane;
  depth: number;
  cut: boolean;
  // Opcional só por compatibilidade com projetos salvos antes desse campo
  // existir — build-model.ts trata ausência como "normal".
  direction?: ExtrudeDirection;
};

export type RevolveFeature = {
  id: string;
  type: "revolve";
  label: string;
  profile: NonNullable<ProfileSource>;
  plane: SketchPlane;
  // Eixo de revolução = a linha de centro do sketch (ao estilo Inventor),
  // não um eixo X/Y fixo. Coordenadas locais do plano, iguais ao profile —
  // convertidas pra mundo só na hora de construir o sólido.
  axisOrigin: Point;
  axisDirection: Point;
  angle: number;
  // Inverte o sentido de rotação em torno do eixo. Opcional por
  // compatibilidade com projetos salvos antes desse campo existir.
  reversed?: boolean;
};

export type HoleFeature = {
  id: string;
  type: "hole";
  label: string;
  center: Point;
  plane: SketchPlane;
  radius: number;
  through: boolean;
  depth: number;
  // Só importa pro furo cego (through=false): de que lado do plano ele
  // entra. Opcional por compatibilidade — ausência vira "flipped" (o
  // comportamento fixo que a ferramenta sempre teve).
  direction?: "normal" | "flipped";
};

// Corta o sólido ativo ao meio num plano, descartando um dos dois lados —
// não consome perfil de sketch, só o plano (o mesmo já selecionado pra
// esboçar) e qual lado fica.
export type SplitFeature = {
  id: string;
  type: "split";
  label: string;
  plane: SketchPlane;
  keepSide: "positive" | "negative";
};

// Plano de trabalho (ao estilo Inventor/SolidWorks "Plane") — deslocado por
// "offset" mm ao longo da normal de uma referência (um dos 3 planos padrão,
// uma face do sólido, ou outro plano de trabalho já criado). Não gera
// geometria nenhuma (rebuildModel só pula), é só uma referência salva na
// árvore pra poder esboçar nela depois — igual um SketchFeature nesse
// sentido, mas sem shapes/pontos, só o plano em si.
export type PlaneFeature = {
  id: string;
  type: "plane";
  label: string;
  plane: SketchPlane; // resultado final (origin já deslocado)
  basePlane: SketchPlane; // referência original, guardada só pra poder reeditar o offset depois
  offset: number;
};

// Eixo de trabalho (ao estilo Inventor/SolidWorks "Axis") — reta que passa
// pelo centroide da face clicada: numa face cilíndrica/cônica (parede de
// um furo, por exemplo) segue o comprimento dela; numa face plana, sai
// normal a ela. Não gera geometria (rebuildModel só pula), é referência
// visual/de planejamento salva na árvore.
export type AxisFeature = {
  id: string;
  type: "axis";
  label: string;
  origin: [number, number, number];
  direction: [number, number, number];
};

// Arredondamento (fillet) de uma ou mais arestas do sólido — ao estilo
// Inventor/SolidWorks "Fillet". edgePoints guarda um ponto de referência
// SOBRE cada aresta escolhida (não a aresta em si, que não sobrevive a uma
// reconstrução do zero) — build-model.ts reencontra a aresta mais próxima
// de cada ponto no sólido reconstruído (findEdgesByPoints).
export type FilletFeature = {
  id: string;
  type: "fillet";
  label: string;
  radius: number;
  edgePoints: [number, number, number][];
};

// Chanfro de uma ou mais arestas — mesma ideia do fillet, mas corta reto em
// vez de arredondar. Chanfro simétrico só (mesma distância nas duas faces);
// distância/ângulo assimétricos ficam pra uma iteração futura.
export type ChamferFeature = {
  id: string;
  type: "chamfer";
  label: string;
  distance: number;
  edgePoints: [number, number, number][];
};

// Ambiente de Chapa (ao estilo Inventor "Sheet Metal"): marca a peça
// inteira como chapa, com uma espessura única compartilhada por todas as
// features Face/Flange dela — igual a "Sheet Metal Rule" do Inventor, não
// um valor por operação. Só existe uma dessas na árvore por vez ("Voltar a
// ser Peça" remove essa feature); não gera geometria por si só.
export type SheetMetalFeature = {
  id: string;
  type: "sheetMetal";
  label: string;
  thickness: number;
};

// Extrusão de chapa (Inventor "Face"): igual Extrudar, mas a profundidade
// NUNCA é escolhida por operação — é sempre a espessura da chapa ativa
// (lida da SheetMetalFeature no momento da reconstrução), pra toda a peça
// manter espessura consistente como uma chapa de verdade.
export type FaceFeature = {
  id: string;
  type: "face";
  label: string;
  profile: NonNullable<ProfileSource>;
  plane: SketchPlane;
  direction?: ExtrudeDirection;
};

// Dobra (Inventor "Flange"): nasce de uma aresta reta já existente da
// chapa, escolhida clicando direto na LINHA dessa aresta (ao estilo
// Inventor) — guarda só os dois extremos dela (não uma referência
// "reencontrável" como fillet/chamfer, porque aqui a geometria nova é
// CONSTRUÍDA a partir desses números, não buscada depois — como a árvore de
// features é reconstruída determinística e sequencialmente, as mesmas
// coordenadas continuam válidas a cada rebuild). Sem campo de normal de
// face: a face de origem da dobra é achada pela GEOMETRIA da própria
// aresta (a face plana de maior área que a contém — ver findMainFaceForEdge
// em edgeTools.ts), nunca por uma normal capturada no clique. Sem campo de
// raio: o raio INTERNO da dobra é sempre a espessura da chapa (o externo
// sempre espessura + espessura = 2x), calculado direto na hora de
// construir — não é algo que o usuário escolhe por Flange, é a mesma regra
// de dobra da chapa inteira. Sem campo de "lado invertido" também — a
// dobra sempre sai pra fora da face de origem; pra dobrar do outro lado,
// clica na aresta do outro lado da peça. comprimento = tamanho da aba,
// medido no plano ANTES de dobrar. parentId = id da Face/Flange de onde a
// aresta nasceu — build-model.ts usa isso pra desfazer a(s) dobra(s) do(s)
// ancestral(is) na hora de planificar (ver FlattenLink em sheetMetal.ts),
// senão uma Flange-sobre-Flange planifica na posição 3D dobrada original.
export type FlangeFeature = {
  id: string;
  type: "flange";
  label: string;
  parentId: string;
  edgeStart: [number, number, number];
  edgeEnd: [number, number, number];
  length: number;
  angle: number;
};

export type Feature =
  | SketchFeature
  | ExtrudeFeature
  | RevolveFeature
  | HoleFeature
  | SplitFeature
  | PlaneFeature
  | AxisFeature
  | FilletFeature
  | ChamferFeature
  | SheetMetalFeature
  | FaceFeature
  | FlangeFeature;

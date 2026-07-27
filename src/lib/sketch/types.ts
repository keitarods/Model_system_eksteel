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
  | "slotCenterPoint"
  // Projetar Geometria (Inventor "Project Geometry"): clica numa aresta do
  // sólido 3D (mostrada como geometria de referência fina) e ela vira uma
  // LineShape de verdade no sketch — cotável, usável em contorno de perfil
  // — em vez de só uma referência visual pra encostar ao desenhar.
  | "projectGeometry";

// Ponto compartilhado do sketch atual. Shapes referenciam pontos por id em
// vez de embutir coordenadas — é isso que dá a "coincidência de graça": duas
// arestas que compartilham um ponto se movem juntas quando a cota que
// controla esse ponto é editada.
export type SketchPoint = { id: string; x: number; y: number };

// Ponto de origem do esboço (0,0 do plano ativo — derivado do eixo/plano
// escolhido pra esboçar, ao estilo Inventor) — sempre presente no pool de
// pontos (semeado em clear()/reabertura de sketch salvo, ver store.ts),
// nunca dentro de uma PointShape própria, então nunca aparece como "forma"
// selecionável/removível — só arrastável seria possível via o mecanismo
// genérico de arrastar ponto da ferramenta Selecionar, por isso movePoints
// ignora explicitamente esse id (ver store.ts). Serve de referência fixa
// pra encostar/cotar, exatamente como o ponto de origem verde do Inventor.
export const ORIGIN_POINT_ID = "origin";
export const ORIGIN_POINT: SketchPoint = { id: ORIGIN_POINT_ID, x: 0, y: 0 };

export type LineShape = {
  id: string;
  type: "line";
  p1: string;
  p2: string;
  // Linha de centro (eixo de revolução, ao estilo Inventor) — não entra na
  // detecção de contorno fechado de findProfileSource, é só referência.
  isCenterLine?: boolean;
  // Veio da ferramenta Projetar Geometria (clicou numa aresta real do
  // sólido/geometria de referência) — só afeta a cor de desenho (ver
  // GEOMETRY_COLOR_PROJECTED em SketchOverlay3D.tsx); participa
  // normalmente de contorno de perfil, cota, etc., como qualquer linha.
  isProjected?: boolean;
  // Trava de eixo PERSISTENTE (ao estilo Inventor: ícone H/V de verdade,
  // não só um "encostar" de um clique só como makeLineHorizontal/Vertical
  // em store.ts) — setada automaticamente nos 4 lados ao desenhar um
  // Retângulo (ver handleRawUp), já que cada lado nasce horizontal OU
  // vertical por construção. Mantida ao arrastar um canto compartilhado
  // (ver computeAxisLockFollowers em store.ts): a PONTA OPOSTA da linha
  // acompanha só no eixo travado, preservando o ângulo reto sem precisar
  // de um solver de verdade.
  axisLock?: "horizontal" | "vertical";
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

// Restrição relacional PERSISTENTE (ao estilo Inventor: o ícone da
// restrição fica "vivo" depois de aplicado, reforçando o resultado sempre
// que a geometria envolvida se mover de novo) — diferente de axisLock
// (campo simples embutido na própria LineShape, usado por
// Horizontal/Vertical), essas envolvem DUAS formas/pontos, então moram
// numa lista à parte em vez de num campo de uma forma só. Reaplicadas por
// reapplyConstraints (sketch/store.ts) toda vez que qualquer ponto se
// move (via movePoints) — numa ÚNICA passada, na ORDEM da lista (não é um
// solver de verdade: uma restrição no início da lista não "sente", na
// MESMA passada, uma mudança causada por outra restrição depois dela).
// Cada shape dependente (lineBId/lineId/pointId, conforme o kind) só deve
// ter NO MÁXIMO uma restrição deste tipo agindo sobre ele por vez — ver
// upsertConstraint em store.ts.
export type SketchConstraint =
  | { id: string; kind: "perpendicular"; lineAId: string; lineBId: string }
  | { id: string; kind: "tangent"; lineId: string; circleId: string }
  | { id: string; kind: "pointOnLine"; pointId: string; lineId: string }
  | { id: string; kind: "lineMidpointOnPoint"; lineId: string; pointId: string };

// Omit comum NÃO distribui sobre union (usa Pick por baixo, que colapsa os
// 4 variantes de SketchConstraint num só objeto genérico, perdendo a
// correlação entre `kind` e os campos específicos de cada um) — "T extends
// any" força a distribuição por membro da união.
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

// SketchConstraint sem o id — o que upsertConstraint recebe, antes de
// gerar um novo id (ver store.ts).
export type NewSketchConstraint = DistributiveOmit<SketchConstraint, "id">;

// Referência a UMA aresta reta específica (não a forma inteira) — precisa
// desambiguar qual das 2 arestas paralelas de um retângulo/rasgo, já que
// nenhuma das duas tem um id de ponto próprio pros 2 cantos derivados (só
// p1/p2 do retângulo, ou center1/center2 do rasgo, são pontos de verdade).
// Resolvida sob demanda (não guarda coordenadas) — acompanha a forma se ela
// for editada depois, igual toda cota paramétrica.
// "point" (ex.: centro de um círculo) participa da MESMA cota "edgeDistance"
// que as arestas retas — um ponto solto vira um segmento degenerado de
// comprimento 0 em resolveEdgeRefSegment (render.ts), o que já faz a
// projeção na reta infinita do outro lado funcionar sem precisar de um kind
// de cota à parte pra "distância de ponto até linha"/"ponto até ponto".
export type EdgeRef =
  | { kind: "line"; lineId: string }
  | { kind: "rectEdge"; rectId: string; axis: "width" | "height"; edge: "p1" | "p2" }
  | { kind: "slotTangent"; slotId: string; side: 1 | -1 }
  | { kind: "point"; pointId: string };

// Cota: "distance" liga dois pontos (editar arrasta p2 em relação a p1 ao
// longo da mesma direção); "radius" controla o raio de um círculo
// diretamente; "width"/"height" controlam só o x ou só o y de p2 em relação
// a p1 de um retângulo (um retângulo só guarda 2 cantos diagonais, não 4
// independentes — largura e altura precisam mexer em eixos separados, não
// dá pra usar "distance" genérico sem also distorcer a outra dimensão).
// Todas são paramétricas — mudar o valor recalcula a geometria.
// `offset` (opcional — ausente em cotas de projetos salvos antes disso
// existir, tratado como um padrão pequeno pra fora na hora de desenhar, ver
// DEFAULT_DIM_OFFSET em render.ts) é a distância da linha de cota até a
// geometria medida, arrastável pelo usuário — igual a cota da folha de
// desenho (DrawingDimension.offset em drawing/types.ts), mesma ideia
// aplicada aqui: linha de extensão + seta, não mais desenhada em cima da
// própria geometria.
// Campos comuns a QUALQUER kind de cota, além do offset (movidos pra cá em
// vez de repetidos em cada variante do union abaixo):
// - isReference: cota de referência ao estilo Inventor ("driven dimension")
//   — só relata a medida atual (derivada da geometria, igual sempre foi),
//   não pode ser editada digitando um valor novo. Opcional por
//   compatibilidade com cotas de projetos salvos antes desse campo existir
//   (ausente = comportamento normal, editável).
// - paramName: nome curto ao estilo Inventor (d1, d2, d3...) — atribuído
//   uma vez só, na criação (ver addDimension/nextParamNumber em store.ts),
//   e nunca reaproveitado nem renumerado depois (apagar d3 não vira "d4 é
//   o novo d3"), pra uma fórmula que referencia "d5" continuar apontando
//   pra a MESMA cota mesmo que outras sejam criadas/apagadas no meio.
//   Ausente em cotas de projetos salvos antes desse campo existir —
//   ensureParamName em store.ts atribui um sob demanda (na hora de
//   referenciar essa cota numa fórmula) se ainda não tiver.
// - formula: fórmula ao estilo Inventor/Excel (ex.: "d9*2", "=d3+5") — só a
//   PRÓPRIA cota edita isso digitando um valor que não é um número puro,
//   ou clicando em outra cota durante a edição (ver
//   pickingFormulaFor/formulaDraft em SketchOverlay3D.tsx, que insere o
//   paramName da cota clicada no texto). Reavaliada e reaplicada sempre
//   que QUALQUER cota referenciada nela mudar de valor (ver
//   cascadeFormulaDependents em store.ts) — recusa formar ciclo (fórmula
//   que dependeria, direta ou indiretamente, de si mesma). Digitar um
//   número puro na cota apaga a fórmula (volta a ser um valor solto).
// - labelT: posição do RÓTULO ao longo da linha de cota (0 = na ponta A,
//   1 = na ponta B, 0.5 = meio — padrão quando ausente). Arrastável
//   independente do offset — junto os dois dão o mesmo "arrastar o texto
//   pra qualquer lugar perto da cota" que o Inventor tem, em vez de só
//   aproximar/afastar. Só usado por cotas lineares (distance/width/height/
//   edgeDistance); cotas de raio usam `angle` no lugar.
// - angle: ângulo (graus, 0 = eixo X positivo, sentido anti-horário) em
//   torno do centro pra onde a cota de RAIO/DIÂMETRO aponta — substitui a
//   direção fixa de 45° (RADIUS_DIM_DEFAULT_ANGLE_DEG em render.ts) que
//   toda cota de raio usava antes de ganhar esse campo; ausente = mantém
//   os 45° de sempre (compatibilidade com cotas de projetos salvos antes
//   disso existir).
type DimensionCommon = {
  offset?: number;
  isReference?: boolean;
  paramName?: string;
  formula?: string;
  labelT?: number;
  angle?: number;
};

export type DimensionAnnotation =
  | ({ id: string; kind: "distance"; p1: string; p2: string } & DimensionCommon)
  | ({ id: string; kind: "radius"; circleId: string } & DimensionCommon)
  | ({ id: string; kind: "width"; rectId: string } & DimensionCommon)
  | ({ id: string; kind: "height"; rectId: string } & DimensionCommon)
  // Raio de um arco de concordância — kind separado (não reaproveita
  // "radius") porque ArcShape não guarda raio próprio, é sempre derivado de
  // center/p1 (ver resolveDimension), então editar precisa mover p1/p2 em
  // vez de só trocar um campo .radius como no círculo.
  | ({ id: string; kind: "arcRadius"; arcId: string } & DimensionCommon)
  // Raio (largura) de um rasgo — SlotShape guarda radius direto, igual
  // círculo, então updateSlotRadiusDimension é estruturalmente idêntico a
  // updateRadiusDimension. O comprimento do rasgo (eixo center1→center2)
  // não precisa de kind própria: é só uma "distance" comum entre os dois
  // centros, que já são pontos de verdade.
  | ({ id: string; kind: "slotRadius"; slotId: string } & DimensionCommon)
  // Distância entre 2 arestas retas selecionadas (uma de cada vez, ao estilo
  // Inventor) — ex.: as 2 tangentes de um rasgo (dá a largura) ou as 2
  // arestas de largura de um retângulo (dá a altura, e vice-versa). Sempre
  // medida como a projeção do ponto médio de `a` na reta infinita de `b` —
  // exata quando paralelas, uma aproximação razoável quando não. Editar
  // mantém `a` parada e move só `b` (ver updateEdgeDistanceDimension em
  // store.ts / translateEdgeRef), mesmo espírito de updateDistanceDimension
  // manter p1 parado.
  | ({ id: string; kind: "edgeDistance"; a: EdgeRef; b: EdgeRef } & DimensionCommon);

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

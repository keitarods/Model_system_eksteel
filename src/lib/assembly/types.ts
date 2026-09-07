// Ambiente de Montagem (ao estilo Inventor .iam): um documento separado do
// Modelador de peça (.eks3d) que referencia várias peças (por vínculo ao
// vivo a um arquivo .eks3d escolhido pelo usuário, não incorporadas) e as
// posiciona/restringe entre si. Ver src/lib/project/linkedFiles.ts pra como
// o vínculo em si é resolvido, e src/lib/assembly/solver.ts pra como as
// restrições viram uma posição/rotação final por componente.

// Posição+rotação completas (6 graus de liberdade) de uma instância de
// componente no espaço da montagem. Sem escala — peças não são
// redimensionadas na montagem, só posicionadas.
export type ComponentPlacement = {
  position: [number, number, number];
  quaternion: [number, number, number, number]; // x, y, z, w
};

export const IDENTITY_PLACEMENT: ComponentPlacement = {
  position: [0, 0, 0],
  quaternion: [0, 0, 0, 1],
};

// Quadro de referência capturado numa face/eixo da peça (ver
// src/lib/assembly/mateFrame.ts), em espaço LOCAL da instância — viaja
// rígido com ela quando a instância é posicionada. Mesma forma de
// SketchPlane (origin/normal/xDir) por consistência com o resto do app,
// mas não é um plano de sketch: aqui só serve pra restrições de montagem.
export type MateFrame = {
  origin: [number, number, number];
  normal: [number, number, number];
  xDir: [number, number, number];
  // Que tipo de geometria foi clicada — só informativo (o solver ignora,
  // sempre alinha origin/normal/xDir do mesmo jeito pros dois casos), usado
  // pra rotular a escolha na UI e sugerir o preset certo (Encaixar/Encostar
  // pra "planar", Inserir/Concêntrico pra "cylindrical"). Ausente = arquivo
  // salvo antes desse campo existir — trata como "planar".
  kind?: "planar" | "cylindrical";
  // Só presente pra kind "cylindrical" (face cilíndrica ou aresta circular
  // de um furo/eixo redondo) — raio em mm, exibido na UI (ex. "Ø20mm").
  radius?: number;
};

export type ComponentInstance = {
  id: string;
  label: string;
  // Chave usada em linkedFiles.ts pra achar o FileSystemFileHandle
  // lembrado da peça de origem — nunca serializado junto (handles não são
  // JSON-serializáveis), só essa chave.
  linkKey: string;
  // Só exibição (nome do último arquivo vinculado/resolvido) — não é usado
  // pra resolver o vínculo de verdade, isso é sempre via linkKey.
  sourceFileName: string;
  // Fixa a instância na origem (posição/rotação identidade), fora do
  // solver — toda montagem precisa de pelo menos 1 componente fixo, igual
  // o "grounded" automático do 1º componente inserido no Inventor.
  grounded: boolean;
  suppressed: boolean;
  visible: boolean;
  // Posição livre (arrastada à mão) ou semente pros graus de liberdade que
  // nenhuma restrição trava — ver solver.ts.
  placementSeed: ComponentPlacement;
};

// Restrição única que cobre Mate/Coincidente/Encostar(Flush)/Inserir/
// Ângulo do Inventor — todos são, no fundo, "alinhar dois quadros de
// referência com um offset/flip/ângulo". O que muda entre eles é só de
// onde o MateFrame veio (face plana = Mate/Flush; eixo de furo = Inserir)
// e os parâmetros escolhidos, não o tipo de restrição em si.
export type MateConstraint = {
  id: string;
  type: "mate";
  label: string;
  instanceA: string;
  frameA: MateFrame;
  instanceB: string;
  frameB: MateFrame;
  // Distância ao longo da normal de A entre as duas origens — só é
  // realmente aplicada se `lockDistance` for true (ver abaixo); senão o
  // campo fica ignorado pelo solver (mas guardado, pra reaproveitar se o
  // usuário travar depois).
  offset: number;
  // false = normais de A e B ficam OPOSTAS (encostando uma face na outra,
  // caso mais comum). true = normais ficam ALINHADAS (uma "dentro" da
  // outra, ex. duas faces internas de uma braçadeira).
  flip: boolean;
  // Rotação (graus) de xDir-B em torno da normal, em relação a xDir-A —
  // só aplicada se `lockAngle` for true.
  angle: number;
  // Trava a translação ao longo da normal/eixo em `offset` — ao estilo
  // Inventor: numa restrição PLANAR (Encaixar/Encostar) é o que define a
  // própria restrição, então vem sempre true; numa CILÍNDRICA (Inserir/
  // Concêntrico) fica false por padrão — só concêntrico, sem travar o
  // "afundamento" — porque só concêntrico já é uma restrição útil sozinha
  // (ex. um parafuso que ainda desliza no furo), e travar os 6 graus de
  // liberdade de uma vez tornaria a peça impossível de arrastar depois
  // (ver findFreeDegreesOfFreedom-like uso em AssemblyWorkspace ao decidir
  // se a peça pode ser arrastada). Ausente (arquivo salvo antes desse campo
  // existir) = trata como true (comportamento antigo, rígido).
  lockDistance?: boolean;
  // Trava a rotação em torno da normal/eixo no ângulo `angle` — sempre
  // false por padrão (ao estilo Inventor: Mate/Flush/Concêntrico sozinhos
  // NÃO travam esse giro; é a restrição de Ângulo, separada, que faz isso).
  // Ausente = trata como true (mesmo raciocínio de `lockDistance` acima).
  lockAngle?: boolean;
};

export type AssemblyConstraint = MateConstraint;

export type AssemblyDocument = {
  instances: ComponentInstance[];
  constraints: AssemblyConstraint[];
};

export function createEmptyAssemblyDocument(): AssemblyDocument {
  return { instances: [], constraints: [] };
}

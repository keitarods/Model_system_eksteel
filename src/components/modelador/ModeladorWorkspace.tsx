"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { ShapeMesh, Solid } from "replicad";
import { createClient } from "@/lib/supabase/client";
import { SketchToolPalette } from "@/components/sketch/SketchToolPalette";
import { useSketchKeyboardShortcuts } from "@/lib/sketch/useSketchKeyboardShortcuts";
import { Viewer3D } from "@/components/viewer/Viewer3D";
import { DrawingSheetWorkspace } from "@/components/drawing/DrawingSheetWorkspace";
import {
  IconAxis,
  IconChamfer,
  IconExtrude,
  IconFace,
  IconFillet,
  IconFinish,
  IconFlange,
  IconFlatten,
  IconHelix,
  IconHole,
  IconLogout,
  IconPatternCircular,
  IconPatternRect,
  IconPlane,
  IconRedo,
  IconRevolve,
  IconSheetMetal,
  IconSketch,
  IconSplit,
  IconSweep,
  IconUndo,
} from "@/components/icons/ToolIcons";
import { useSketchStore } from "@/lib/sketch/store";
import { BASE_SKETCH_PLANE, ORIGIN_POINT, ORIGIN_POINT_ID } from "@/lib/sketch/types";
import type { SketchPlane } from "@/lib/sketch/types";
import { loadOpenCascade } from "@/lib/replicad/opencascade";
import { findCenterLine, findLastCircle, findProfileSource, findProfileSources, findSelectedCircles } from "@/lib/replicad/geometry";
import { rebuildModel, findFlangeParentId } from "@/lib/replicad/build-model";
import { sketchPlaneFromHit, worldToLocalPoint, offsetOrigin, STANDARD_PLANES, STANDARD_AXES } from "@/lib/replicad/plane";
import { isPatternable } from "@/lib/replicad/pattern";
import { useFeatureStore } from "@/lib/features/store";
import { useDrawingStore } from "@/lib/drawing/store";
import type { Feature } from "@/lib/features/types";
import type { ExtrudeDirection } from "@/lib/replicad/geometry";
import { redoModel, undoModel, useUndoStore } from "@/lib/history/store";
import { NATIVE_FILE_EXTENSION, parseProject, serializeProject } from "@/lib/project/nativeFormat";
import { buildDxf } from "@/lib/project/dxf";
import { exportFaceToDxf } from "@/lib/replicad/faceExport";
import { findClickedAxis } from "@/lib/replicad/axisTools";
import { findClickedEdge, listLinearEdges } from "@/lib/replicad/edgeTools";
import {
  isFileSystemAccessSupported,
  loadRememberedFolder,
  pickFileToOpen,
  pickProjectFolder,
  pickSaveFileHandle,
  saveOrDownload,
  writeToFileHandle,
} from "@/lib/project/folder";

function createId() {
  return Math.random().toString(36).slice(2, 10);
}

// Exceções vindas do WASM/OpenCascade às vezes não são Error de verdade
// (podem ser só um número/ponteiro do embind) — isso extrai uma descrição
// legível de qualquer coisa que possa ter sido lançada, pra não perder o
// valor bruto quando isso acontece.
function describeThrown(err: unknown): string {
  if (err instanceof Error) return err.message;
  return `valor bruto lançado: ${String(err)}`;
}

// Tipos de <input> sem histórico de texto de verdade pra desfazer — número/
// checkbox/radio/select não têm "digitação" nativa que Ctrl+Z do navegador
// faria sentido preservar. Ignorar Ctrl+Z/Ctrl+Y só por causa do foco estar
// num campo de RAIO/DISTÂNCIA/etc. (a barra de ferramentas do esboço está
// cheia desses) fazia o atalho parecer quebrado durante o esboço — o foco
// quase sempre está num desses campos logo depois de digitar um valor.
const NON_TEXT_INPUT_TYPES = new Set(["number", "checkbox", "radio", "range", "color", "button", "submit", "reset", "file"]);

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  if (target instanceof HTMLInputElement) return !NON_TEXT_INPUT_TYPES.has(target.type);
  return false;
}

// Painel em "quadrante", ao estilo dos painéis da ribbon do Inventor
// (Criar/Modificar/Trabalho/Chapa...) — caixa própria com o nome do painel
// embaixo, mesma ideia do SketchToolPalette na aba de esboço.
function FeaturePanel({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex shrink-0 flex-col items-center gap-1 rounded-lg border border-primary-200 bg-white/70 px-1.5 pb-1 pt-1.5">
      <div className="flex flex-wrap items-start gap-1">{children}</div>
      <span className="text-[10px] font-semibold uppercase tracking-wide text-primary-400">{label}</span>
    </div>
  );
}

// Botão "grande" da ribbon (ícone em cima, nome embaixo) — ao contrário dos
// botões compactos (ícone ao lado do texto) usados em painéis contextuais
// de parâmetro; Extrudar/Revolucionar/Furo/etc. são comandos PRINCIPAIS, e
// no Inventor esses continuam com o nome sempre visível embaixo do ícone,
// nunca escondido.
function FeatureToolButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  active,
  title,
}: {
  icon?: ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      className={`flex w-16 shrink-0 flex-col items-center justify-center gap-1 rounded-lg px-1 py-1.5 text-center text-[11px] font-semibold leading-tight transition disabled:cursor-not-allowed disabled:opacity-40 ${
        active ? "bg-primary text-primary-foreground" : "bg-white text-primary-700 hover:bg-primary-100"
      }`}
    >
      {Icon && <Icon className="shrink-0" />}
      <span>{label}</span>
    </button>
  );
}

function isBasePlane(plane: SketchPlane) {
  return (
    plane.origin.every((v, i) => Math.abs(v - BASE_SKETCH_PLANE.origin[i]) < 1e-6) &&
    plane.normal.every((v, i) => Math.abs(v - BASE_SKETCH_PLANE.normal[i]) < 1e-6)
  );
}

// Direções de mundo pro Padrão Retangular — v1 simplificada, sem escolher
// uma aresta arbitrária como direção (ver pattern.ts).
const AXIS_VECTORS: Record<"x" | "y" | "z", [number, number, number]> = {
  x: [1, 0, 0],
  y: [0, 1, 0],
  z: [0, 0, 1],
};

function sameVec3(a: [number, number, number], b: [number, number, number]): boolean {
  return Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6 && Math.abs(a[2] - b[2]) < 1e-6;
}

// Reconstrói qual botão X/Y/Z do Padrão Retangular gerou esse vetor, pra
// reabrir o painel de edição já marcado — v1 só produz eixos padrão, então
// não precisa de tolerância além de ponto flutuante.
function vectorToAxisLabel(v: [number, number, number]): "x" | "y" | "z" {
  if (sameVec3(v, AXIS_VECTORS.x)) return "x";
  if (sameVec3(v, AXIS_VECTORS.y)) return "y";
  return sameVec3(v, AXIS_VECTORS.z) ? "z" : "x";
}

const FEATURE_BADGE: Record<Feature["type"], { label: string; className: string }> = {
  sketch: { label: "SK", className: "bg-primary-100 text-primary-700" },
  extrude: { label: "EX", className: "bg-primary-600 text-white" },
  revolve: { label: "RV", className: "bg-primary-400 text-primary-900" },
  hole: { label: "FR", className: "bg-primary-800 text-white" },
  split: { label: "CT", className: "bg-primary-300 text-primary-900" },
  plane: { label: "PL", className: "bg-amber-200 text-amber-900" },
  axis: { label: "EI", className: "bg-teal-200 text-teal-900" },
  fillet: { label: "AR", className: "bg-emerald-200 text-emerald-900" },
  chamfer: { label: "CH", className: "bg-orange-200 text-orange-900" },
  sheetMetal: { label: "CP", className: "bg-sky-200 text-sky-900" },
  face: { label: "FC", className: "bg-sky-600 text-white" },
  flange: { label: "FL", className: "bg-sky-400 text-sky-900" },
  sweep: { label: "VR", className: "bg-violet-300 text-violet-900" },
  helix: { label: "ES", className: "bg-violet-500 text-white" },
  pattern: { label: "PD", className: "bg-rose-200 text-rose-900" },
};

export function ModeladorWorkspace({ userEmail }: { userEmail: string }) {
  const router = useRouter();
  // "desenho" troca a área principal inteira (toolbar + árvore + viewport
  // 3D) pela folha de desenho 2D — mesmo projeto, só uma tela diferente,
  // ao estilo de trocar de aba (não é uma rota/página separada).
  const [mode, setMode] = useState<"modelar" | "desenho">("modelar");
  const shapes = useSketchStore((s) => s.shapes);
  const points = useSketchStore((s) => s.points);
  const dimensions = useSketchStore((s) => s.dimensions);
  const constraints = useSketchStore((s) => s.constraints);
  const fixedPointIds = useSketchStore((s) => s.fixedPointIds);
  const activePlane = useSketchStore((s) => s.activePlane);
  const setActivePlane = useSketchStore((s) => s.setActivePlane);
  const clearSketch = useSketchStore((s) => s.clear);
  const multiProfileSelection = useSketchStore((s) => s.multiProfileSelection);
  const clearProfileSelection = useSketchStore((s) => s.clearProfileSelection);

  const features = useFeatureStore((s) => s.features);
  const addFeature = useFeatureStore((s) => s.addFeature);
  const updateFeature = useFeatureStore((s) => s.updateFeature);
  const removeFeature = useFeatureStore((s) => s.removeFeature);
  const drawingSheets = useDrawingStore((s) => s.sheets);

  const canUndo = useUndoStore((s) => s.past.length > 0);
  const canRedo = useUndoStore((s) => s.future.length > 0);

  // Ao estilo Inventor: ou você está esboçando (só ferramentas de sketch,
  // sem aplicar features) ou está no modelo (aplica Extrudar/Revolucionar/
  // Furo/Cortar sobre o último esboço concluído). Começa FORA do modo
  // esboço — abrir o app não deveria jogar direto num sketch vazio/solto
  // sem o usuário ter pedido isso; "Criar Esboço" (que já pede o plano,
  // ver handleCreateSketch/pickingPlane) é o único jeito de entrar num.
  const [sketching, setSketching] = useState(false);
  const [pickingPlane, setPickingPlane] = useState(false);
  // Criar Plano (ao estilo Inventor/SolidWorks "Plane"): creatingPlane liga
  // o modo inteiro; planeBase null = ainda escolhendo a referência (plano
  // padrão ou face), planeBase preenchido = ajustando o deslocamento
  // (arrastando no 3D ou digitando) antes de confirmar como operação.
  const [creatingPlane, setCreatingPlane] = useState(false);
  const [planeBase, setPlaneBase] = useState<SketchPlane | null>(null);
  const [planeOffset, setPlaneOffset] = useState(20);
  // Criar Eixo (ao estilo Inventor/SolidWorks "Axis"): clica numa face
  // cilíndrica (parede de furo — eixo pelo centroide, ao longo dela) ou
  // plana (eixo normal, pelo centroide) e a operação já é criada na hora,
  // sem etapa de ajuste (diferente do Plano, não tem um valor pra digitar).
  const [pickingAxisFace, setPickingAxisFace] = useState(false);
  // Arredondar/Chanfrar (ao estilo Inventor/SolidWorks "Fillet"/"Chamfer"):
  // clica em uma ou mais arestas do sólido (mesmo pickMode do resto),
  // acumulando em selectedEdgePoints — só vira operação de verdade ao
  // confirmar (uma feature só, com todas as arestas escolhidas).
  const [edgeToolMode, setEdgeToolMode] = useState<"fillet" | "chamfer" | null>(null);
  const [selectedEdgePoints, setSelectedEdgePoints] = useState<[number, number, number][]>([]);
  const [filletRadius3d, setFilletRadius3d] = useState(3);
  const [chamferDistance3d, setChamferDistance3d] = useState(3);
  // Ambiente de Chapa (ao estilo Inventor "Sheet Metal"): a espessura vive
  // numa SheetMetalFeature única na árvore, não em estado local — isso é só
  // o valor sugerido/editado no confirm-step de "Virar Chapa" (ver
  // creatingSheetMetal) antes de existir uma, ou ao reabrir a feature já
  // criada pra editar (double-click na árvore).
  const [newSheetThickness, setNewSheetThickness] = useState(2);
  // "Virar Chapa" agora abre seu próprio confirm-step (ao estilo Fillet/
  // Chamfer/Plano), em vez de um campo de espessura solto na barra ANTES
  // de clicar a ferramenta — a espessura só é digitada DENTRO da
  // ferramenta, e o mesmo confirm-step é reaproveitado pra editar a
  // SheetMetalFeature já existente (ver handleEditFeature).
  const [creatingSheetMetal, setCreatingSheetMetal] = useState(false);
  const [faceDirection, setFaceDirection] = useState<ExtrudeDirection>("normal");
  // "Cut" da chapa (Inventor): mesma extrusão da Face, na espessura da
  // chapa, mas subtraindo — recorta a chapa com o perfil desenhado.
  const [faceCut, setFaceCut] = useState(false);
  // Flange: clique direto na LINHA de uma aresta reta da chapa (ao estilo
  // Inventor — ver LinearEdgePicker3D em Viewer3D.tsx), não mais na face —
  // flangeCandidate guarda a aresta exata enquanto os parâmetros (ângulo,
  // comprimento) ainda estão sendo ajustados, antes de confirmar.
  const [flangePicking, setFlangePicking] = useState(false);
  const [flangeCandidate, setFlangeCandidate] = useState<{
    start: [number, number, number];
    end: [number, number, number];
  } | null>(null);
  const [flangeLength, setFlangeLength] = useState(20);
  const [flangeAngle, setFlangeAngle] = useState(90);
  // Alterna a visualização inteira entre dobrada (3D real) e planificada
  // (padrão plano pra corte/DXF) — não mexe na árvore de features, só como
  // rebuildModel trata as Flanges dessa reconstrução em diante.
  const [flattenView, setFlattenView] = useState(false);
  // Em telas estreitas, os 2 painéis (histórico/3D) não cabem lado a lado —
  // só um fica visível por vez, alternado por abas. Em md+ os dois
  // continuam lado a lado como sempre (esse estado é ignorado nesse caso).
  // O 3D agora é o único viewport (desenhar/selecionar funciona nele
  // direto), então não existe mais uma aba "Esboço" separada.
  const [mobileTab, setMobileTab] = useState<"viewer" | "history">("viewer");

  // Largura da árvore de histórico em md+ (px), ajustável arrastando a
  // divisória entre ela e o 3D — ao estilo do painel do modelo do Inventor.
  // Só faz sentido em md+ (abaixo disso os 2 painéis nunca ficam lado a
  // lado, um de cada vez via mobileTab) — por isso o style inline com essa
  // largura só é aplicado quando isDesktop, senão atropelaria o layout
  // empilhado (largura cheia) do mobile.
  const [historyPanelWidth, setHistoryPanelWidth] = useState(220);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia("(min-width: 768px)");
    const update = () => setIsDesktop(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);

  const handleHistoryResizeStart = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = historyPanelWidth;

      function handleMove(moveEvent: PointerEvent) {
        const next = startWidth + (moveEvent.clientX - startX);
        setHistoryPanelWidth(Math.min(480, Math.max(160, next)));
      }
      function handleUp() {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
      }
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
    },
    [historyPanelWidth]
  );

  // Altura da barra de ferramentas principal, ajustável arrastando a
  // divisória logo abaixo dela — mesma ideia da largura da árvore de
  // histórico. 96 = altura inicial (equivalente ao antigo max-h-24 fixo).
  const [toolbarHeight, setToolbarHeight] = useState(96);

  const handleToolbarResizeStart = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      const startHeight = toolbarHeight;

      function handleMove(moveEvent: PointerEvent) {
        const next = startHeight + (moveEvent.clientY - startY);
        setToolbarHeight(Math.min(320, Math.max(40, next)));
      }
      function handleUp() {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
      }
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
    },
    [toolbarHeight]
  );

  useSketchKeyboardShortcuts();
  // Qual SketchFeature da árvore o esboço ao vivo representa — null quando é
  // um esboço novo ainda não salvo. Concluir Esboço cria ou atualiza essa
  // entrada, em vez de duplicar uma nova toda vez.
  const [editingSketchId, setEditingSketchId] = useState<string | null>(null);
  // Incrementa a cada plano escolhido/reaberto — o Viewer3D usa isso (não a
  // referência do plano em si) como gatilho pra reorientar a câmera de
  // frente pro plano, ao estilo Inventor/SolidWorks, mesmo que o mesmo
  // plano padrão seja escolhido duas vezes seguidas.
  const [planeFocusToken, setPlaneFocusToken] = useState(0);
  // Pasta local do projeto (File System Access — só Chrome/Edge por
  // enquanto). null não bloqueia salvar/exportar, só faz cair pro download
  // comum do navegador em vez de gravar direto na pasta.
  const [projectFolder, setProjectFolder] = useState<FileSystemDirectoryHandle | null>(null);
  const [currentFileHandle, setCurrentFileHandle] = useState<FileSystemFileHandle | null>(null);
  const [currentFileName, setCurrentFileName] = useState<string | null>(null);
  // null = ainda não checou (evita mismatch de hidratação: no servidor
  // isFileSystemAccessSupported() sempre dá false por não ter `window`).
  // Só depois de montado no client é que sabemos de verdade se o navegador
  // suporta — sem isso, "Salvar" nunca consegue gravar no mesmo arquivo,
  // sempre cai no window.prompt() de nome (por isso "Salvar" parece "Salvar
  // Como" toda vez nesse caso).
  const [fsAccessSupported, setFsAccessSupported] = useState<boolean | null>(null);
  useEffect(() => {
    setFsAccessSupported(isFileSystemAccessSupported());
  }, []);

  const [extrudeDepth, setExtrudeDepth] = useState(20);
  const [extrudeCut, setExtrudeCut] = useState(false);
  // Sentido ao estilo Inventor: segue a normal do plano, vai pro lado
  // oposto, ou sai simétrico (metade pra cada lado, centrado no plano).
  const [extrudeDirection, setExtrudeDirection] = useState<ExtrudeDirection>("normal");
  const [revolveAngle, setRevolveAngle] = useState(360);
  const [revolveReversed, setRevolveReversed] = useState(false);
  const [revolveCut, setRevolveCut] = useState(false);
  const [holeThrough, setHoleThrough] = useState(true);
  const [holeDepth, setHoleDepth] = useState(10);
  // "flipped" reproduz o comportamento que o furo cego sempre teve (entra
  // pro lado oposto da normal) — é o padrão pra não mudar o resultado de
  // quem já usava a ferramenta antes desse controle existir.
  const [holeDirection, setHoleDirection] = useState<"normal" | "flipped">("flipped");
  const [splitKeepSide, setSplitKeepSide] = useState<"positive" | "negative">("positive");

  // Qual ferramenta de criar feature está com o "diálogo" de parâmetros
  // aberto (ao estilo Inventor: clicar no ícone abre uma telinha só com os
  // campos daquela ferramenta, em vez de mostrar TODAS as ferramentas com
  // todos os campos ao mesmo tempo, o que era o principal motivo da barra
  // de ferramentas ocupar tanto espaço). null = grade compacta de botões
  // (estado ocioso). Cada handleAdd* fecha o diálogo (volta pra null) só
  // quando a feature é criada com sucesso — se cair num early return
  // (validação), o diálogo continua aberto com a mensagem de erro visível.
  const [featureToolMode, setFeatureToolMode] = useState<
    "extrude" | "face" | "revolve" | "hole" | "split" | "sweep" | "helix" | "patternRect" | "patternCircular" | null
  >(null);
  // Varredura — caminho vem de outro sketch já salvo na árvore (não o
  // ativo, que é sempre o PERFIL); null enquanto nenhum foi escolhido ainda.
  const [sweepPathFeatureId, setSweepPathFeatureId] = useState<string | null>(null);
  const [sweepCut, setSweepCut] = useState(false);
  // Espiral/Mola — mesmo eixo (linha de centro) da Revolução; raio vem do
  // perfil automaticamente (ver buildHelixSolid), não é campo aqui.
  const [helixPitch, setHelixPitch] = useState(5);
  const [helixTurns, setHelixTurns] = useState(5);
  const [helixReversed, setHelixReversed] = useState(false);
  const [helixCut, setHelixCut] = useState(false);
  // Padrão — direções/eixo em X/Y/Z do MUNDO (v1 simplificada; não dá pra
  // escolher uma aresta arbitrária como direção ainda). sourceFeatureId
  // null enquanto nenhuma feature de origem foi escolhida.
  const [patternSourceFeatureId, setPatternSourceFeatureId] = useState<string | null>(null);
  const [patternDir1, setPatternDir1] = useState<"x" | "y" | "z">("x");
  const [patternCount1, setPatternCount1] = useState(3);
  const [patternSpacing1, setPatternSpacing1] = useState(20);
  const [patternDir2Enabled, setPatternDir2Enabled] = useState(false);
  const [patternDir2, setPatternDir2] = useState<"x" | "y" | "z">("y");
  const [patternCount2, setPatternCount2] = useState(3);
  const [patternSpacing2, setPatternSpacing2] = useState(20);
  // Eixo da circular: um dos 3 eixos padrão de mundo, ou o id de uma
  // AxisFeature já criada na árvore.
  const [patternAxisChoice, setPatternAxisChoice] = useState<string>("z");
  const [patternCount, setPatternCount] = useState(4);
  const [patternAngle, setPatternAngle] = useState(360);
  // Id da feature sendo REEDITADA (não criada) — quando setado, os mesmos
  // painéis de Extrudar/Face/Revolucionar/Furo/Cortar por Plano/Arredondar/
  // Chanfrar/Flange/Plano usados na criação reabrem preenchidos com os
  // valores atuais da feature, e o botão de confirmar ATUALIZA ela no lugar
  // (updateFeature, preservando profile/plane/edgePoints/etc. originais) em
  // vez de criar uma nova (ver handleEditFeature). Substitui os prompts
  // sequenciais que só cobriam campo por campo.
  const [editingFeatureId, setEditingFeatureId] = useState<string | null>(null);

  const [mesh, setMesh] = useState<ShapeMesh | null>(null);
  // Arestas do sólido ativo em coordenadas de mundo (flat, pares de pontos
  // xyz) — servem de referência visual no esboço 2D, ao estilo "Project
  // Geometry" do Inventor, sem precisar desenhar o esboço dentro do 3D.
  const [edgeLines, setEdgeLines] = useState<number[]>([]);
  // Arestas RETAS do sólido ativo, com os dois extremos exatos — alimenta a
  // camada de linhas clicáveis do Flange (LinearEdgePicker3D em
  // Viewer3D.tsx), que substitui o antigo clique-na-face + busca da aresta
  // mais próxima (impreciso perto de cantos/arestas vizinhas curtas).
  const [linearEdges, setLinearEdges] = useState<
    { start: [number, number, number]; end: [number, number, number] }[]
  >([]);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);
  const solidRef = useRef<Solid | null>(null);
  const generationRef = useRef(0);

  // Projeta as arestas do sólido no plano ativo do sketch (2D local) — só
  // matemática, recalcula quando o sólido OU o plano muda, sem precisar de
  // WASM. É a referência visual "onde estou na peça" pedida.
  const referenceGeometry = useMemo(() => {
    const segments: { x1: number; y1: number; x2: number; y2: number }[] = [];
    for (let i = 0; i + 5 < edgeLines.length; i += 6) {
      const a = worldToLocalPoint(activePlane, [edgeLines[i], edgeLines[i + 1], edgeLines[i + 2]]);
      const b = worldToLocalPoint(activePlane, [edgeLines[i + 3], edgeLines[i + 4], edgeLines[i + 5]]);
      segments.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    }
    return segments;
  }, [edgeLines, activePlane]);

  // "profile" (singular) continua servindo Varredura/Hélice, que não
  // ganharam seleção múltipla (perfil delas é sempre o mais recente do
  // sketch ativo, igual sempre foi). Extrudar/Cortar/Face/Revolução usam
  // "profile" TAMBÉM — union type (ProfileSources em features/types.ts) —
  // mas quando há Ctrl+clique ativo (multiProfileSelection não vazio),
  // reaproveita o MESMO nome pra virar o array das formas marcadas, unidas
  // entre si em profilesToDrawing (build-model.ts) na hora de construir.
  const singleProfile = findProfileSource(shapes, points);
  const profile =
    multiProfileSelection.length > 0
      ? (() => {
          const selected = findProfileSources(shapes, points, multiProfileSelection);
          return selected.length > 0 ? selected : null;
        })()
      : singleProfile;
  // Só pra exibir "N perfis selecionados" — multiProfileSelection.length
  // por si só conta ids de FORMA (ex.: as 4 linhas de um retângulo
  // desenhado como 4 linhas, ver toggleProfileSelection em sketch/store.ts
  // contam como 1 perfil só), não perfis de verdade, então deriva do
  // resultado já deduplicado (profile) em vez do array bruto.
  const selectedProfileCount = multiProfileSelection.length > 0 ? (Array.isArray(profile) ? profile.length : profile ? 1 : 0) : 0;
  const lastCircle = findLastCircle(shapes, points);
  // Furo com Ctrl+clique: cada círculo marcado em multiProfileSelection
  // (ver toggleProfileSelection em sketch/store.ts) vira um furo próprio —
  // sem seleção múltipla, cai pro círculo mais recente de sempre.
  const selectedCircles = multiProfileSelection.length > 0 ? findSelectedCircles(shapes, points, multiProfileSelection) : [];
  const holeCircles = selectedCircles.length > 0 ? selectedCircles : lastCircle ? [lastCircle] : [];
  // Ao estilo Inventor: Revolução exige uma linha de centro explícita no
  // sketch — sem ela, o eixo não está definido e só Extrudar fica disponível.
  const centerLine = findCenterLine(shapes, points);
  const hasActiveSolid = mesh !== null;
  const hasFinishedSketch = shapes.length > 0 || Object.keys(points).length > 0;
  const sheetMetalFeature = features.find(
    (f): f is Extract<Feature, { type: "sheetMetal" }> => f.type === "sheetMetal"
  );
  const isSheetMetal = !!sheetMetalFeature;
  const hasFlangeFeature = features.some((f) => f.type === "flange");
  // Sketches já salvos na árvore — caminho da Varredura escolhe entre eles
  // (nunca o sketch ATIVO, que é sempre o perfil).
  const pathSketchOptions = features.filter((f): f is Extract<Feature, { type: "sketch" }> => f.type === "sketch");
  // Só Extrudar/Face/Revolução/Furo são "padronizáveis" nessa v1 (ver
  // isPatternable em pattern.ts).
  const patternableFeatures = features.filter(isPatternable);
  const patternAxisOptions: { id: string; label: string; origin: [number, number, number]; direction: [number, number, number] }[] = [
    ...STANDARD_AXES,
    ...features
      .filter((f): f is Extract<Feature, { type: "axis" }> => f.type === "axis")
      .map((f) => ({ id: f.id, label: f.label, origin: f.origin, direction: f.direction })),
  ];

  // Ao estilo Inventor: enquanto o painel de Extrudar/Face/Revolução/Furo/
  // Cortar por Plano/Varredura/Espiral está aberto (criando OU editando),
  // monta a MESMA feature que o botão de confirmar criaria/salvaria — mas
  // sem commitar no histórico — pra alimentar a reconstrução do sólido logo
  // abaixo e dar uma pré-visualização ao vivo conforme os campos mudam.
  // Padrão/Fillet/Chamfro/Flange/Plano ficam de fora dessa 1ª versão: a
  // origem deles é uma SELEÇÃO (aresta clicada, feature de origem), não um
  // punhado de campos numéricos como esses — pré-visualizá-los exigiria
  // reagir ao hover/clique antes mesmo de confirmar, um mecanismo diferente
  // deste aqui.
  const draftFeature = useMemo<Feature | null>(() => {
    if (!featureToolMode) return null;

    if (editingFeatureId) {
      const original = features.find((f) => f.id === editingFeatureId);
      if (!original) return null;
      if (featureToolMode === "extrude" && original.type === "extrude") {
        return { ...original, depth: extrudeDepth, cut: extrudeCut, direction: extrudeDirection };
      }
      if (featureToolMode === "face" && original.type === "face") {
        return { ...original, direction: faceDirection, cut: faceCut };
      }
      if (featureToolMode === "revolve" && original.type === "revolve") {
        return { ...original, angle: revolveAngle, reversed: revolveReversed, cut: revolveCut };
      }
      if (featureToolMode === "hole" && original.type === "hole") {
        return { ...original, through: holeThrough, depth: holeDepth, direction: holeDirection };
      }
      if (featureToolMode === "split" && original.type === "split") {
        return { ...original, keepSide: splitKeepSide };
      }
      if (featureToolMode === "sweep" && original.type === "sweep") {
        return { ...original, pathFeatureId: sweepPathFeatureId ?? original.pathFeatureId, cut: sweepCut };
      }
      if (featureToolMode === "helix" && original.type === "helix") {
        return { ...original, pitch: helixPitch, turns: helixTurns, reversed: helixReversed, cut: helixCut };
      }
      return null;
    }

    if (featureToolMode === "extrude") {
      if (!profile) return null;
      return {
        id: "__preview__",
        type: "extrude",
        label: "",
        profile,
        plane: activePlane,
        depth: extrudeDepth,
        cut: extrudeCut,
        direction: extrudeDirection,
      };
    }
    if (featureToolMode === "face") {
      if (!profile || !sheetMetalFeature) return null;
      return { id: "__preview__", type: "face", label: "", profile, plane: activePlane, direction: faceDirection, cut: faceCut };
    }
    if (featureToolMode === "revolve") {
      if (!profile || !centerLine) return null;
      return {
        id: "__preview__",
        type: "revolve",
        label: "",
        profile,
        plane: activePlane,
        axisOrigin: centerLine.origin,
        axisDirection: centerLine.direction,
        angle: revolveAngle,
        reversed: revolveReversed,
        cut: revolveCut,
      };
    }
    if (featureToolMode === "hole") {
      if (holeCircles.length === 0 || !hasActiveSolid) return null;
      const [firstHole, ...restHoles] = holeCircles;
      return {
        id: "__preview__",
        type: "hole",
        label: "",
        center: { x: firstHole.cx, y: firstHole.cy },
        plane: activePlane,
        radius: firstHole.r,
        extraHoles: restHoles.map((c) => ({ center: { x: c.cx, y: c.cy }, radius: c.r })),
        through: holeThrough,
        depth: holeDepth,
        direction: holeDirection,
      };
    }
    if (featureToolMode === "split") {
      if (!hasActiveSolid) return null;
      return { id: "__preview__", type: "split", label: "", plane: activePlane, keepSide: splitKeepSide };
    }
    if (featureToolMode === "sweep") {
      if (!profile || !sweepPathFeatureId) return null;
      return {
        id: "__preview__",
        type: "sweep",
        label: "",
        profile,
        plane: activePlane,
        pathFeatureId: sweepPathFeatureId,
        cut: sweepCut,
      };
    }
    if (featureToolMode === "helix") {
      if (!profile || !centerLine) return null;
      return {
        id: "__preview__",
        type: "helix",
        label: "",
        profile,
        plane: activePlane,
        axisOrigin: centerLine.origin,
        axisDirection: centerLine.direction,
        pitch: helixPitch,
        turns: helixTurns,
        reversed: helixReversed,
        cut: helixCut,
      };
    }
    return null;
  }, [
    featureToolMode,
    editingFeatureId,
    features,
    profile,
    activePlane,
    sheetMetalFeature,
    centerLine,
    holeCircles,
    hasActiveSolid,
    sweepPathFeatureId,
    extrudeDepth,
    extrudeCut,
    extrudeDirection,
    faceDirection,
    faceCut,
    revolveAngle,
    revolveReversed,
    revolveCut,
    holeThrough,
    holeDepth,
    holeDirection,
    splitKeepSide,
    sweepCut,
    helixPitch,
    helixTurns,
    helixReversed,
    helixCut,
  ]);

  // Debounce curto (não instantâneo) pra não disparar uma reconstrução WASM
  // completa a cada tecla digitada num campo numérico — mas limpa a
  // pré-visualização IMEDIATAMENTE (sem debounce) ao fechar o painel, senão
  // o sólido rascunho ficaria "grudado" na tela por mais alguns ms depois de
  // cancelar.
  const [debouncedDraftFeature, setDebouncedDraftFeature] = useState<Feature | null>(null);
  useEffect(() => {
    if (!draftFeature) {
      setDebouncedDraftFeature(null);
      return;
    }
    const timer = setTimeout(() => setDebouncedDraftFeature(draftFeature), 200);
    return () => clearTimeout(timer);
  }, [draftFeature]);

  // Histórico "efetivo" que a reconstrução do sólido usa: igual ao histórico
  // de verdade (features), só que com a feature rascunho da pré-visualização
  // substituindo a original (editando) ou somada no fim (criando) — nunca
  // commitado em features/useFeatureStore, só existe pra essa reconstrução.
  const effectiveFeatures = useMemo(() => {
    if (!debouncedDraftFeature) return features;
    if (editingFeatureId) {
      return features.map((f) => (f.id === editingFeatureId ? debouncedDraftFeature : f));
    }
    return [...features, debouncedDraftFeature];
  }, [features, debouncedDraftFeature, editingFeatureId]);

  const showNotice = useCallback((message: string) => {
    setNoticeMessage(message);
    window.setTimeout(() => {
      setNoticeMessage((current) => (current === message ? null : current));
    }, 2500);
  }, []);

  // Ctrl+Z desfaz, Ctrl+Y ou Ctrl+Shift+Z refaz — aceita ctrlKey OU metaKey
  // direto (em vez de escolher um dos dois via sniffing de navigator.platform,
  // que é depreciado e pode reportar errado) pra não depender de detectar
  // Mac certinho. Ignora quando o foco está num campo de TEXTO de verdade
  // (preserva o undo nativo do navegador ali); campos numéricos/checkbox/
  // select não bloqueiam (ver isTextEntryTarget). Registrado na fase de
  // CAPTURA (3º argumento true), não a de borbulhamento — roda ANTES de
  // qualquer handler de elemento descendente, então nenhum stopPropagation()
  // por aí (existente ou futuro) consegue engolir o atalho antes dele
  // chegar aqui.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (isTextEntryTarget(e.target)) return;

      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        undoModel();
      } else if (key === "y" || (key === "z" && e.shiftKey)) {
        e.preventDefault();
        redoModel();
      }
    }

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, []);

  // Garante que a aba mobile mostre o 3D (onde esboço/escolha de plano
  // acontecem) sempre que entrar num desses modos — evita o usuário ficar
  // preso na aba Histórico sem ver o que precisa clicar.
  useEffect(() => {
    if (sketching || pickingPlane || creatingPlane || pickingAxisFace || edgeToolMode || flangePicking || creatingSheetMetal)
      setMobileTab("viewer");
  }, [sketching, pickingPlane, creatingPlane, pickingAxisFace, edgeToolMode, flangePicking, creatingSheetMetal]);

  // Título da aba ao estilo Inventor: mostra o nome do arquivo aberto/salvo
  // por último, não só o nome genérico do app.
  useEffect(() => {
    document.title = currentFileName ? `${currentFileName} — Modelador Eksteel` : "Modelador Eksteel";
  }, [currentFileName]);

  // Recupera a pasta do projeto lembrada de uma sessão anterior (se o
  // navegador suportar) — não pede permissão de novo aqui, só reidrata o
  // handle; a permissão de escrita é reconfirmada na hora de salvar.
  useEffect(() => {
    loadRememberedFolder().then((handle) => {
      if (handle) setProjectFolder(handle);
    });
  }, []);

  // Reconstrói o sólido do zero sempre que o histórico de features muda —
  // mais simples e mais seguro do que tentar atualizar incrementalmente.
  // Sem features ainda, nem vale a pena baixar o WASM (~10MB) só pra
  // confirmar que o resultado é "nenhum sólido".
  useEffect(() => {
    if (effectiveFeatures.length === 0) {
      solidRef.current?.delete();
      solidRef.current = null;
      setMesh(null);
      setEdgeLines([]);
      setLinearEdges([]);
      setStatus("idle");
      setErrorMessage(null);
      return;
    }

    let cancelled = false;
    const generation = ++generationRef.current;

    (async () => {
      setStatus("loading");
      try {
        await loadOpenCascade();

        let next: Solid | null;
        try {
          next = rebuildModel(effectiveFeatures, { flatten: flattenView });
        } catch (err) {
          throw new Error(`Falha ao construir o sólido (${describeThrown(err)}).`);
        }

        if (cancelled || generation !== generationRef.current) {
          next?.delete();
          return;
        }

        solidRef.current?.delete();
        solidRef.current = next;

        let nextMesh: ShapeMesh | null = null;
        let nextEdgeLines: number[] = [];
        let nextLinearEdges: { start: [number, number, number]; end: [number, number, number] }[] = [];
        try {
          nextMesh = next ? next.mesh() : null;
          nextEdgeLines = next ? next.meshEdges().lines : [];
          nextLinearEdges = next ? listLinearEdges(next) : [];
        } catch (err) {
          // O sólido foi construído mas é topologicamente inválido demais
          // pra triangular (geometria auto-interseptante, por exemplo) —
          // acontece principalmente com Flange mal posicionada.
          throw new Error(`Sólido construído mas inválido para exibir (${describeThrown(err)}).`);
        }
        setMesh(nextMesh);
        setEdgeLines(nextEdgeLines);
        setLinearEdges(nextLinearEdges);
        setStatus("idle");
        setErrorMessage(null);
      } catch (err) {
        if (cancelled || generation !== generationRef.current) return;
        // Exceções vindas do replicad/OpenCascade (WASM) às vezes não são
        // Error de verdade (podem ser um número, string ou objeto do
        // embind) — sem logar aqui, o valor real fica invisível e só sobra
        // a mensagem genérica de baixo pro usuário.
        console.error("Erro ao reconstruir o sólido:", err);
        setStatus("error");
        setErrorMessage(
          err instanceof Error ? err.message : "Erro ao gerar o sólido."
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [effectiveFeatures, flattenView]);

  // Ao estilo Inventor/SolidWorks: sempre mostra as opções de plano (os 3
  // planos padrão de origem, mais qualquer face do sólido existente) em vez
  // de assumir XY direto — o usuário escolhe visualmente no 3D ou pelos
  // botões da barra.
  const handleCreateSketch = useCallback(() => {
    setEditingSketchId(null);
    setPickingPlane(true);
  }, []);

  // Atalho S ao estilo Inventor: fora do modo esboço, inicia "Criar
  // Esboço" (abre a escolha de plano). Dentro de um esboço já em edição,
  // "S" continua sendo a ferramenta Selecionar — esse atalho não interfere
  // nesse caso (useSketchKeyboardShortcuts cuida dele à parte).
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.toLowerCase() !== "s") return;

      const target = e.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }

      if (
        !sketching &&
        !pickingPlane &&
        !creatingPlane &&
        !pickingAxisFace &&
        !edgeToolMode &&
        !flangePicking &&
        !creatingSheetMetal
      ) {
        e.preventDefault();
        handleCreateSketch();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [sketching, pickingPlane, creatingPlane, pickingAxisFace, edgeToolMode, flangePicking, creatingSheetMetal, handleCreateSketch]);

  const handleUseStandardPlane = useCallback(
    (plane: SketchPlane) => {
      setEditingSketchId(null);
      setActivePlane(plane);
      clearSketch();
      setPickingPlane(false);
      setSketching(true);
      setPlaneFocusToken((t) => t + 1);
      showNotice("Esboçando no plano selecionado.");
    },
    [setActivePlane, clearSketch, showNotice]
  );

  const handlePickPlane = useCallback(
    (origin: [number, number, number], normal: [number, number, number]) => {
      setEditingSketchId(null);
      setActivePlane(sketchPlaneFromHit(origin, normal));
      clearSketch();
      setPickingPlane(false);
      setSketching(true);
      setPlaneFocusToken((t) => t + 1);
      showNotice("Esboçando na face selecionada.");
    },
    [setActivePlane, clearSketch, showNotice]
  );

  // Ao estilo Inventor: exporta o contorno da face clicada como DXF 2D
  // "achatado" no próprio plano dela — não precisa de sketch nenhum, lê
  // direto do sólido já construído. Disparado pelo menu de contexto (botão
  // direito numa face), não por um modo de escolha separado.
  const handleExportFaceDxf = useCallback(
    async (origin: [number, number, number], normal: [number, number, number]) => {
      if (!solidRef.current) return;

      const dxfText = exportFaceToDxf(solidRef.current, origin, normal);
      if (!dxfText) {
        setErrorMessage("Não consegui identificar uma face plana nesse ponto — tente clicar mais perto do centro da face.");
        return;
      }

      const blob = new Blob([dxfText], { type: "application/dxf" });
      const result = await saveOrDownload(projectFolder, blob, "face.dxf");
      showNotice(result === "folder" ? "Face exportada em DXF na pasta selecionada." : "Face exportada em DXF.");
    },
    [projectFolder, showNotice]
  );

  const handleCreateAxis = useCallback(() => {
    setPickingAxisFace(true);
  }, []);

  // Ao estilo Inventor: os 3 eixos padrão de origem (X/Y/Z) — clique único,
  // sem etapa de ajuste (eles são retas fixas, não tem "deslocamento" como
  // um plano offset).
  const handleUseStandardAxis = useCallback(
    (axis: { label: string; origin: [number, number, number]; direction: [number, number, number] }) => {
      setPickingAxisFace(false);
      addFeature({
        id: createId(),
        type: "axis",
        label: axis.label,
        origin: axis.origin,
        direction: axis.direction,
      });
      showNotice(`${axis.label} criado.`);
    },
    [addFeature, showNotice]
  );

  // Ao estilo Inventor: clica numa face cilíndrica/cônica (eixo pelo
  // centroide, ao longo dela — é o centro real de um furo, por exemplo) ou
  // plana (eixo normal, pelo centroide) e a operação já entra na árvore na
  // hora, sem etapa extra de ajuste.
  const handleAxisFacePicked = useCallback(
    (origin: [number, number, number]) => {
      setPickingAxisFace(false);
      if (!solidRef.current) return;

      const axis = findClickedAxis(solidRef.current, origin);
      if (!axis) {
        setErrorMessage(
          "Não consegui identificar um eixo nessa face — tente clicar numa face cilíndrica (parede de um furo) ou plana."
        );
        return;
      }

      addFeature({
        id: createId(),
        type: "axis",
        label: "Eixo (centroide)",
        origin: axis.origin,
        direction: axis.direction,
      });
      showNotice("Eixo criado.");
    },
    [addFeature, showNotice]
  );

  // Arredondar/Chanfrar: cada clique numa aresta soma (ou tira, se já
  // estava escolhida) selectedEdgePoints — a operação em si só é criada ao
  // confirmar (handleConfirmEdgeTool), permitindo escolher várias arestas
  // antes de aplicar um raio/distância só.
  const handleEdgePicked = useCallback((origin: [number, number, number]) => {
    if (!solidRef.current) return;
    const hit = findClickedEdge(solidRef.current, origin);
    if (!hit) {
      setErrorMessage(
        "Não consegui identificar uma aresta nesse ponto — tente clicar mais perto de uma borda do sólido."
      );
      return;
    }
    setSelectedEdgePoints((prev) => {
      const idx = prev.findIndex(
        (p) => Math.hypot(p[0] - hit.point[0], p[1] - hit.point[1], p[2] - hit.point[2]) < 1
      );
      if (idx >= 0) return prev.filter((_, i) => i !== idx);
      return [...prev, hit.point];
    });
  }, []);

  const handleStartFillet = useCallback(() => {
    setEdgeToolMode("fillet");
    setSelectedEdgePoints([]);
  }, []);

  const handleStartChamfer = useCallback(() => {
    setEdgeToolMode("chamfer");
    setSelectedEdgePoints([]);
  }, []);

  const handleCancelEdgeTool = useCallback(() => {
    setEdgeToolMode(null);
    setSelectedEdgePoints([]);
  }, []);

  const handleConfirmEdgeTool = useCallback(() => {
    if (!edgeToolMode || selectedEdgePoints.length === 0) return;
    const count = selectedEdgePoints.length;
    const suffix = count > 1 ? `s (${count} arestas)` : " (1 aresta)";

    if (editingFeatureId) {
      const original = features.find((f) => f.id === editingFeatureId && f.type === edgeToolMode) as
        | Extract<Feature, { type: "fillet" | "chamfer" }>
        | undefined;
      if (!original) {
        setEditingFeatureId(null);
        setEdgeToolMode(null);
        setSelectedEdgePoints([]);
        return;
      }
      // Arestas continuam as mesmas de quando a feature foi criada — editar
      // só troca o raio/distância, não reabre a escolha de arestas no 3D
      // (selectedEdgePoints foi preenchido com edgePoints ao entrar em modo
      // de edição, ver handleEditFeature).
      if (edgeToolMode === "fillet") {
        updateFeature(editingFeatureId, {
          ...(original as Extract<Feature, { type: "fillet" }>),
          radius: filletRadius3d,
          label: `Arredondar R${filletRadius3d}mm${suffix}`,
        });
      } else {
        updateFeature(editingFeatureId, {
          ...(original as Extract<Feature, { type: "chamfer" }>),
          distance: chamferDistance3d,
          label: `Chanfrar ${chamferDistance3d}mm${suffix}`,
        });
      }
      showNotice(edgeToolMode === "fillet" ? "Arredondamento atualizado." : "Chanfro atualizado.");
      setEditingFeatureId(null);
      setEdgeToolMode(null);
      setSelectedEdgePoints([]);
      return;
    }

    if (edgeToolMode === "fillet") {
      addFeature({
        id: createId(),
        type: "fillet",
        label: `Arredondar R${filletRadius3d}mm${suffix}`,
        radius: filletRadius3d,
        edgePoints: selectedEdgePoints,
      });
    } else {
      addFeature({
        id: createId(),
        type: "chamfer",
        label: `Chanfrar ${chamferDistance3d}mm${suffix}`,
        distance: chamferDistance3d,
        edgePoints: selectedEdgePoints,
      });
    }

    showNotice(edgeToolMode === "fillet" ? "Arredondamento criado." : "Chanfro criado.");
    setEdgeToolMode(null);
    setSelectedEdgePoints([]);
  }, [edgeToolMode, selectedEdgePoints, filletRadius3d, chamferDistance3d, addFeature, showNotice, editingFeatureId, features, updateFeature]);

  // "Voltar a ser Peça": só remove a SheetMetalFeature — as Face/Flange já
  // criadas continuam existindo como geometria comum, só perdem as
  // ferramentas específicas de chapa. Não tem confirm-step (não pede
  // nenhum valor), diferente de criar/editar (ver handleConfirmSheetMetal).
  const handleRevertSheetMetal = useCallback(() => {
    if (!sheetMetalFeature) return;
    removeFeature(sheetMetalFeature.id);
    showNotice("Voltou a ser peça comum.");
  }, [sheetMetalFeature, removeFeature, showNotice]);

  // Confirma o confirm-step de "Virar Chapa" — cria a SheetMetalFeature
  // única da árvore (espessura compartilhada por Face/Flange dela em
  // diante) ou, se estiver editando uma já existente (double-click na
  // árvore, ver handleEditFeature), só atualiza a espessura dela.
  const handleConfirmSheetMetal = useCallback(() => {
    if (newSheetThickness <= 0) return;
    if (editingFeatureId) {
      const original = features.find((f) => f.id === editingFeatureId && f.type === "sheetMetal") as
        | Extract<Feature, { type: "sheetMetal" }>
        | undefined;
      if (original) {
        updateFeature(editingFeatureId, {
          ...original,
          thickness: newSheetThickness,
          label: `Chapa ${newSheetThickness}mm`,
        });
        showNotice("Espessura da chapa atualizada.");
      }
      setEditingFeatureId(null);
      setCreatingSheetMetal(false);
      return;
    }
    addFeature({
      id: createId(),
      type: "sheetMetal",
      label: `Chapa ${newSheetThickness}mm`,
      thickness: newSheetThickness,
    });
    showNotice(`Peça virou chapa de ${newSheetThickness}mm.`);
    setCreatingSheetMetal(false);
  }, [editingFeatureId, features, newSheetThickness, addFeature, updateFeature, showNotice]);

  const handleCancelSheetMetal = useCallback(() => {
    setCreatingSheetMetal(false);
    setEditingFeatureId(null);
  }, []);

  // "Face" (Inventor): igual Extrudar, mas a profundidade é sempre a
  // espessura da chapa ativa, nunca escolhida aqui. Com "Corte" marcado,
  // vira o "Cut" do Inventor: mesma extrusão, mas recorta em vez de somar.
  const handleAddFace = useCallback(() => {
    const arrow = faceDirection === "flipped" ? " ←" : faceDirection === "symmetric" ? " ↔" : " →";

    if (editingFeatureId) {
      const original = features.find((f) => f.id === editingFeatureId && f.type === "face") as
        | Extract<Feature, { type: "face" }>
        | undefined;
      if (!original) {
        setEditingFeatureId(null);
        setFeatureToolMode(null);
        return;
      }
      if (faceCut && !hasActiveSolid) {
        setErrorMessage("Não há chapa ativa para recortar — desmarque “Corte” ou crie a Face base primeiro.");
        return;
      }
      updateFeature(editingFeatureId, {
        ...original,
        direction: faceDirection,
        cut: faceCut,
        label: `Face ${sheetMetalFeature?.thickness}mm${faceCut ? " (corte)" : ""}${arrow}`,
      });
      setEditingFeatureId(null);
      setFeatureToolMode(null);
      showNotice("Face atualizada.");
      return;
    }

    if (!profile || !sheetMetalFeature) return;
    if (faceCut && !hasActiveSolid) {
      setErrorMessage(
        "Não há chapa ativa para recortar — desmarque “Corte” ou crie a Face base primeiro."
      );
      return;
    }
    addFeature({
      id: createId(),
      type: "face",
      label: `Face ${sheetMetalFeature.thickness}mm${faceCut ? " (corte)" : ""}${arrow}`,
      profile,
      plane: activePlane,
      direction: faceDirection,
      cut: faceCut,
    });
    clearSketch();
    clearProfileSelection();
    setEditingSketchId(null);
    setFeatureToolMode(null);
  }, [
    profile,
    sheetMetalFeature,
    faceDirection,
    faceCut,
    hasActiveSolid,
    activePlane,
    addFeature,
    clearSketch,
    clearProfileSelection,
    editingFeatureId,
    features,
    updateFeature,
    showNotice,
  ]);

  const handleStartFlange = useCallback(() => {
    setFlangePicking(true);
    setFlangeCandidate(null);
  }, []);

  const handleCancelFlange = useCallback(() => {
    setFlangePicking(false);
    setFlangeCandidate(null);
  }, []);

  // Clique direto na LINHA de uma aresta durante o picking de Flange (ao
  // estilo Inventor — ver LinearEdgePicker3D em Viewer3D.tsx): o segmento
  // clicado já É a aresta exata do sólido, sem precisar de nenhuma busca
  // "mais próxima do ponto clicado na face" — isso eliminava a ambiguidade
  // perto de cantos/arestas curtas vizinhas que causava dobras nascendo na
  // aresta errada.
  const handleFlangeLinePicked = useCallback(
    (start: [number, number, number], end: [number, number, number]) => {
      setFlangeCandidate({ start, end });
    },
    []
  );

  const handleConfirmFlange = useCallback(() => {
    if (!flangeCandidate) return;

    if (editingFeatureId) {
      const original = features.find((f) => f.id === editingFeatureId && f.type === "flange") as
        | Extract<Feature, { type: "flange" }>
        | undefined;
      if (!original) {
        setEditingFeatureId(null);
        setFlangePicking(false);
        setFlangeCandidate(null);
        return;
      }
      // parentId/edgeStart/edgeEnd continuam os mesmos — editar só troca
      // comprimento/ângulo, sem reescolher a aresta de origem no 3D.
      updateFeature(editingFeatureId, {
        ...original,
        length: flangeLength,
        angle: flangeAngle,
        label: `Flange ${flangeLength}mm ${flangeAngle}°`,
      });
      setEditingFeatureId(null);
      setFlangePicking(false);
      setFlangeCandidate(null);
      showNotice("Flange atualizada.");
      return;
    }

    // O pai é a Face/Flange que REALMENTE originou a aresta clicada — nunca
    // "a última da árvore" (isso quebra assim que a peça ramifica: duas
    // Flanges irmãs direto da base, ou uma encadeada criada depois de uma
    // irmã). build-model.ts usa esse parentId pra desfazer a dobra dele (se
    // houver) na hora de planificar.
    const parentId = findFlangeParentId(features, flangeCandidate.start, flangeCandidate.end);
    if (!parentId) {
      setErrorMessage(
        "Não consegui identificar de qual Face/Flange essa aresta nasceu — tente clicar em outra aresta."
      );
      return;
    }

    addFeature({
      id: createId(),
      type: "flange",
      label: `Flange ${flangeLength}mm ${flangeAngle}°`,
      parentId,
      edgeStart: flangeCandidate.start,
      edgeEnd: flangeCandidate.end,
      length: flangeLength,
      angle: flangeAngle,
    });
    setFlangePicking(false);
    setFlangeCandidate(null);
    showNotice("Flange criada.");
  }, [features, flangeCandidate, flangeLength, flangeAngle, addFeature, showNotice, editingFeatureId, updateFeature]);

  // Roteia o clique numa face do 3D conforme o que estava pedindo o clique
  // — mesmo pickMode serve pra escolher plano de esboço, escolher a face de
  // um eixo, escolher arestas pra Arredondar/Chanfrar. Flange NÃO passa mais
  // por aqui — ela escolhe a aresta clicando direto na linha (ver
  // handleFlangeLinePicked/LinearEdgePicker3D), então um clique na face
  // enquanto flangePicking está ativo não deve fazer nada.
  const handleFacePicked = useCallback(
    (origin: [number, number, number], normal: [number, number, number]) => {
      if (flangePicking) return;
      if (edgeToolMode) {
        handleEdgePicked(origin);
        return;
      }
      if (pickingAxisFace) {
        handleAxisFacePicked(origin);
        return;
      }
      if (creatingPlane && !planeBase) {
        setPlaneBase(sketchPlaneFromHit(origin, normal));
        return;
      }
      handlePickPlane(origin, normal);
    },
    [
      flangePicking,
      edgeToolMode,
      handleEdgePicked,
      pickingAxisFace,
      creatingPlane,
      planeBase,
      handleAxisFacePicked,
      handlePickPlane,
    ]
  );

  // Roteia o clique num dos 3 planos padrão — igual handleFacePicked, mas
  // pro seletor de planos (que já entrega um SketchPlane pronto).
  const handleStandardPlanePicked = useCallback(
    (plane: SketchPlane) => {
      if (creatingPlane && !planeBase) {
        setPlaneBase(plane);
        return;
      }
      handleUseStandardPlane(plane);
    },
    [creatingPlane, planeBase, handleUseStandardPlane]
  );

  const handleCreatePlane = useCallback(() => {
    setCreatingPlane(true);
    setPlaneBase(null);
    setPlaneOffset(20);
  }, []);

  const handleConfirmPlane = useCallback(() => {
    if (!planeBase) return;

    if (editingFeatureId) {
      const original = features.find((f) => f.id === editingFeatureId && f.type === "plane") as
        | Extract<Feature, { type: "plane" }>
        | undefined;
      if (!original) {
        setEditingFeatureId(null);
        setCreatingPlane(false);
        setPlaneBase(null);
        return;
      }
      updateFeature(editingFeatureId, {
        ...original,
        offset: planeOffset,
        plane: { ...planeBase, origin: offsetOrigin(planeBase, planeOffset) },
        label: `Plano (offset ${planeOffset.toFixed(1)}mm)`,
      });
      setEditingFeatureId(null);
      setCreatingPlane(false);
      setPlaneBase(null);
      showNotice("Plano de trabalho atualizado.");
      return;
    }

    addFeature({
      id: createId(),
      type: "plane",
      label: `Plano (offset ${planeOffset.toFixed(1)}mm)`,
      plane: { ...planeBase, origin: offsetOrigin(planeBase, planeOffset) },
      basePlane: planeBase,
      offset: planeOffset,
    });
    setCreatingPlane(false);
    setPlaneBase(null);
    showNotice("Plano de trabalho criado.");
  }, [planeBase, planeOffset, addFeature, showNotice, editingFeatureId, features, updateFeature]);

  const handleCancelPlane = useCallback(() => {
    setCreatingPlane(false);
    setPlaneBase(null);
  }, []);

  // Reabre um esboço salvo na árvore: carrega os dados dele de volta pro
  // sketch ao vivo e entra em modo esboço, lembrando qual entrada atualizar
  // quando "Concluir Esboço" for clicado de novo.
  const handleOpenSketch = useCallback(
    (feature: Extract<Feature, { type: "sketch" }>) => {
      useSketchStore.setState({
        shapes: feature.shapes,
        // Mescla a origem — esboços salvos antes dela existir não têm esse
        // ponto no JSON.
        points: { [ORIGIN_POINT_ID]: ORIGIN_POINT, ...feature.points },
        dimensions: feature.dimensions,
        // Projetos salvos antes desse campo existir não têm constraints/
        // fixedPointIds no JSON — cai pra lista vazia.
        constraints: feature.constraints ?? [],
        fixedPointIds: feature.fixedPointIds ?? [],
        activePlane: feature.plane,
      });
      setEditingSketchId(feature.id);
      setPickingPlane(false);
      setSketching(true);
      setPlaneFocusToken((t) => t + 1);
      showNotice(`Editando "${feature.label}".`);
    },
    [showNotice]
  );

  const handleFinishSketch = useCallback(() => {
    const sketchCount = features.filter((f) => f.type === "sketch").length;

    if (editingSketchId) {
      const existing = features.find((f) => f.id === editingSketchId);
      updateFeature(editingSketchId, {
        id: editingSketchId,
        type: "sketch",
        label: existing?.type === "sketch" ? existing.label : `Esboço ${sketchCount + 1}`,
        plane: activePlane,
        shapes,
        points,
        dimensions,
        constraints,
        fixedPointIds,
      });
    } else {
      const id = createId();
      addFeature({
        id,
        type: "sketch",
        label: `Esboço ${sketchCount + 1}`,
        plane: activePlane,
        shapes,
        points,
        dimensions,
        constraints,
        fixedPointIds,
      });
      setEditingSketchId(id);
    }

    setSketching(false);
  }, [features, editingSketchId, activePlane, shapes, points, dimensions, constraints, fixedPointIds, addFeature, updateFeature]);

  const handleEditSketch = useCallback(() => {
    setSketching(true);
  }, []);

  const handleAddExtrude = useCallback(() => {
    const directionArrow = extrudeDirection === "flipped" ? " ←" : extrudeDirection === "symmetric" ? " ↔" : " →";

    if (editingFeatureId) {
      const original = features.find((f) => f.id === editingFeatureId && f.type === "extrude") as
        | Extract<Feature, { type: "extrude" }>
        | undefined;
      if (!original) {
        setEditingFeatureId(null);
        setFeatureToolMode(null);
        return;
      }
      if (extrudeCut && !hasActiveSolid) {
        setErrorMessage("Não há sólido ativo para cortar — desmarque “Corte” ou crie um sólido primeiro.");
        return;
      }
      updateFeature(editingFeatureId, {
        ...original,
        depth: extrudeDepth,
        cut: extrudeCut,
        direction: extrudeDirection,
        label: `Extrudar ${extrudeDepth}mm${extrudeCut ? " (corte)" : ""}${directionArrow}`,
      });
      setEditingFeatureId(null);
      setFeatureToolMode(null);
      showNotice("Extrudar atualizado.");
      return;
    }

    if (!profile) return;
    if (extrudeCut && !hasActiveSolid) {
      setErrorMessage(
        "Não há sólido ativo para cortar — desmarque “Corte” ou crie um sólido primeiro."
      );
      return;
    }
    addFeature({
      id: createId(),
      type: "extrude",
      label: `Extrudar ${extrudeDepth}mm${extrudeCut ? " (corte)" : ""}${directionArrow}`,
      profile,
      plane: activePlane,
      depth: extrudeDepth,
      cut: extrudeCut,
      direction: extrudeDirection,
    });
    clearSketch();
    clearProfileSelection();
    setEditingSketchId(null);
    setFeatureToolMode(null);
  }, [
    profile,
    extrudeCut,
    extrudeDepth,
    extrudeDirection,
    hasActiveSolid,
    activePlane,
    addFeature,
    clearSketch,
    clearProfileSelection,
    editingFeatureId,
    features,
    updateFeature,
    showNotice,
  ]);

  const handleAddRevolve = useCallback(() => {
    if (editingFeatureId) {
      const original = features.find((f) => f.id === editingFeatureId && f.type === "revolve") as
        | Extract<Feature, { type: "revolve" }>
        | undefined;
      if (!original) {
        setEditingFeatureId(null);
        setFeatureToolMode(null);
        return;
      }
      if (revolveCut && !hasActiveSolid) {
        setErrorMessage("Não há sólido ativo para cortar — desmarque “Corte” ou crie um sólido primeiro.");
        return;
      }
      updateFeature(editingFeatureId, {
        ...original,
        angle: revolveAngle,
        reversed: revolveReversed,
        cut: revolveCut,
        label: `Revolução ${revolveAngle}° ${revolveReversed ? "↺" : "↻"}${revolveCut ? " (corte)" : ""}`,
      });
      setEditingFeatureId(null);
      setFeatureToolMode(null);
      showNotice("Revolução atualizada.");
      return;
    }

    if (!profile || !centerLine) return;
    if (revolveCut && !hasActiveSolid) {
      setErrorMessage(
        "Não há sólido ativo para cortar — desmarque “Corte” ou crie um sólido primeiro."
      );
      return;
    }
    addFeature({
      id: createId(),
      type: "revolve",
      label: `Revolução ${revolveAngle}° ${revolveReversed ? "↺" : "↻"}${revolveCut ? " (corte)" : ""}`,
      profile,
      plane: activePlane,
      axisOrigin: centerLine.origin,
      axisDirection: centerLine.direction,
      angle: revolveAngle,
      reversed: revolveReversed,
      cut: revolveCut,
    });
    clearSketch();
    clearProfileSelection();
    setEditingSketchId(null);
    setFeatureToolMode(null);
  }, [
    profile,
    centerLine,
    revolveAngle,
    revolveReversed,
    revolveCut,
    hasActiveSolid,
    activePlane,
    addFeature,
    clearSketch,
    clearProfileSelection,
    editingFeatureId,
    features,
    updateFeature,
    showNotice,
  ]);

  const handleAddHole = useCallback(() => {
    if (editingFeatureId) {
      const original = features.find((f) => f.id === editingFeatureId && f.type === "hole") as
        | Extract<Feature, { type: "hole" }>
        | undefined;
      if (!original) {
        setEditingFeatureId(null);
        setFeatureToolMode(null);
        return;
      }
      const extraCount = original.extraHoles?.length ?? 0;
      updateFeature(editingFeatureId, {
        ...original,
        through: holeThrough,
        depth: holeDepth,
        direction: holeDirection,
        label: `Furo Ø${(original.radius * 2).toFixed(1)}${
          holeThrough ? " passante" : ` x${holeDepth}mm ${holeDirection === "flipped" ? "←" : "→"}`
        }${extraCount > 0 ? ` (${extraCount + 1}x)` : ""}`,
      });
      setEditingFeatureId(null);
      setFeatureToolMode(null);
      showNotice("Furo atualizado.");
      return;
    }

    if (holeCircles.length === 0 || !hasActiveSolid) return;
    const [firstHole, ...restHoles] = holeCircles;
    addFeature({
      id: createId(),
      type: "hole",
      label: `Furo Ø${(firstHole.r * 2).toFixed(1)}${
        holeThrough ? " passante" : ` x${holeDepth}mm ${holeDirection === "flipped" ? "←" : "→"}`
      }${holeCircles.length > 1 ? ` (${holeCircles.length}x)` : ""}`,
      center: { x: firstHole.cx, y: firstHole.cy },
      plane: activePlane,
      radius: firstHole.r,
      extraHoles: restHoles.map((c) => ({ center: { x: c.cx, y: c.cy }, radius: c.r })),
      through: holeThrough,
      depth: holeDepth,
      direction: holeDirection,
    });
    clearSketch();
    clearProfileSelection();
    setEditingSketchId(null);
    setFeatureToolMode(null);
  }, [
    holeCircles,
    hasActiveSolid,
    holeThrough,
    holeDepth,
    holeDirection,
    activePlane,
    addFeature,
    clearSketch,
    clearProfileSelection,
    editingFeatureId,
    features,
    updateFeature,
    showNotice,
  ]);

  // Editar reabre o MESMO painel usado pra criar aquela feature (ver
  // featureToolMode/edgeToolMode/flangePicking/creatingPlane), preenchido
  // com os valores atuais — não só "a medida" via prompt como antes. Os
  // campos estruturais que a feature já tem gravados (profile/plane/
  // edgePoints/edgeStart-edgeEnd/parentId/basePlane) NÃO são reexpostos pro
  // usuário reescolher aqui — só os campos que o painel de criação sempre
  // deixou editáveis; ver handleAddExtrude/handleAddFace/handleAddRevolve/
  // handleAddHole/handleAddSplit/handleConfirmEdgeTool/handleConfirmFlange/
  // handleConfirmPlane pra como o confirmar de cada painel detecta
  // editingFeatureId e ATUALIZA a feature original em vez de criar uma nova.
  const handleEditFeature = useCallback(
    (feature: Feature) => {
      if (feature.type === "sketch") return; // esboços usam onOpenSketch
      if (feature.type === "axis") return; // derivado direto da face — nada pra reeditar, só remover e recriar

      // Garante exclusividade entre os painéis antes de abrir o certo —
      // sem isso, editar uma feature de um tipo enquanto o painel de OUTRO
      // tipo já estava aberto (criando ou editando) deixaria estado
      // fantasma que faz a árvore de ternários da barra mostrar o painel
      // errado (ela decide qual mostrar pela ordem: plano > eixo > aresta >
      // flange > featureToolMode).
      setFeatureToolMode(null);
      setEdgeToolMode(null);
      setSelectedEdgePoints([]);
      setFlangePicking(false);
      setFlangeCandidate(null);
      setCreatingPlane(false);
      setPlaneBase(null);
      setPickingPlane(false);
      setPickingAxisFace(false);

      if (feature.type === "extrude") {
        setExtrudeDepth(feature.depth);
        setExtrudeCut(feature.cut);
        setExtrudeDirection(feature.direction ?? "normal");
        setEditingFeatureId(feature.id);
        setFeatureToolMode("extrude");
        return;
      }

      if (feature.type === "revolve") {
        setRevolveAngle(feature.angle);
        setRevolveReversed(feature.reversed ?? false);
        setRevolveCut(feature.cut ?? false);
        setEditingFeatureId(feature.id);
        setFeatureToolMode("revolve");
        return;
      }

      if (feature.type === "hole") {
        setHoleThrough(feature.through);
        setHoleDepth(feature.depth);
        setHoleDirection(feature.direction ?? "flipped");
        setEditingFeatureId(feature.id);
        setFeatureToolMode("hole");
        return;
      }

      if (feature.type === "plane") {
        setPlaneBase(feature.basePlane);
        setPlaneOffset(feature.offset);
        setEditingFeatureId(feature.id);
        setCreatingPlane(true);
        return;
      }

      if (feature.type === "fillet") {
        setFilletRadius3d(feature.radius);
        setSelectedEdgePoints(feature.edgePoints);
        setEditingFeatureId(feature.id);
        setEdgeToolMode("fillet");
        return;
      }

      if (feature.type === "chamfer") {
        setChamferDistance3d(feature.distance);
        setSelectedEdgePoints(feature.edgePoints);
        setEditingFeatureId(feature.id);
        setEdgeToolMode("chamfer");
        return;
      }

      if (feature.type === "sheetMetal") {
        // Mesmo confirm-step de "Virar Chapa" (ver handleConfirmSheetMetal),
        // só com editingFeatureId setado — igual Plano/Fillet/Chamfer, em
        // vez do window.prompt nativo que existia aqui antes.
        setNewSheetThickness(feature.thickness);
        setEditingFeatureId(feature.id);
        setCreatingSheetMetal(true);
        return;
      }

      if (feature.type === "face") {
        setFaceDirection(feature.direction ?? "normal");
        setFaceCut(feature.cut ?? false);
        setEditingFeatureId(feature.id);
        setFeatureToolMode("face");
        return;
      }

      if (feature.type === "flange") {
        setFlangeLength(feature.length);
        setFlangeAngle(feature.angle);
        setFlangeCandidate({ start: feature.edgeStart, end: feature.edgeEnd });
        setEditingFeatureId(feature.id);
        setFlangePicking(true);
        return;
      }

      if (feature.type === "sweep") {
        setSweepPathFeatureId(feature.pathFeatureId);
        setSweepCut(feature.cut ?? false);
        setEditingFeatureId(feature.id);
        setFeatureToolMode("sweep");
        return;
      }

      if (feature.type === "helix") {
        setHelixPitch(feature.pitch);
        setHelixTurns(feature.turns);
        setHelixReversed(feature.reversed ?? false);
        setHelixCut(feature.cut ?? false);
        setEditingFeatureId(feature.id);
        setFeatureToolMode("helix");
        return;
      }

      if (feature.type === "pattern") {
        setPatternSourceFeatureId(feature.sourceFeatureId);
        if (feature.kind === "rectangular") {
          setPatternDir1(vectorToAxisLabel(feature.dir1));
          setPatternCount1(feature.count1);
          setPatternSpacing1(feature.spacing1);
          const hasDir2 = !!feature.dir2 && !!feature.count2;
          setPatternDir2Enabled(hasDir2);
          if (feature.dir2) setPatternDir2(vectorToAxisLabel(feature.dir2));
          if (feature.count2) setPatternCount2(feature.count2);
          if (feature.spacing2) setPatternSpacing2(feature.spacing2);
          setEditingFeatureId(feature.id);
          setFeatureToolMode("patternRect");
        } else {
          const match = patternAxisOptions.find(
            (a) => sameVec3(a.origin, feature.axisOrigin) && sameVec3(a.direction, feature.axisDirection)
          );
          setPatternAxisChoice(match?.id ?? "z");
          setPatternCount(feature.count);
          setPatternAngle(feature.angle);
          setEditingFeatureId(feature.id);
          setFeatureToolMode("patternCircular");
        }
        return;
      }

      // Só sobra "split" depois de eliminar os outros tipos do union.
      setSplitKeepSide(feature.keepSide);
      setEditingFeatureId(feature.id);
      setFeatureToolMode("split");
    },
    [updateFeature, patternAxisOptions]
  );

  // Cancelar qualquer painel de edição volta pro estado ocioso igual
  // cancelar uma criação nova — chamado nos botões "Cancelar" de cada
  // painel junto com o reset de estado que já existia (setFeatureToolMode/
  // setEdgeToolMode/setFlangePicking/setCreatingPlane com null/false).
  const handleCancelEditingFeature = useCallback(() => {
    setEditingFeatureId(null);
  }, []);

  const handleAddSplit = useCallback(() => {
    if (editingFeatureId) {
      const original = features.find((f) => f.id === editingFeatureId && f.type === "split") as
        | Extract<Feature, { type: "split" }>
        | undefined;
      if (!original) {
        setEditingFeatureId(null);
        setFeatureToolMode(null);
        return;
      }
      updateFeature(editingFeatureId, {
        ...original,
        keepSide: splitKeepSide,
        label: `Cortar por plano (${splitKeepSide === "positive" ? "lado +" : "lado -"})`,
      });
      setEditingFeatureId(null);
      setFeatureToolMode(null);
      showNotice("Corte por plano atualizado.");
      return;
    }

    if (!hasActiveSolid) return;
    addFeature({
      id: createId(),
      type: "split",
      label: `Cortar por plano (${splitKeepSide === "positive" ? "lado +" : "lado -"})`,
      plane: activePlane,
      keepSide: splitKeepSide,
    });
    setFeatureToolMode(null);
  }, [hasActiveSolid, activePlane, splitKeepSide, addFeature, editingFeatureId, features, updateFeature, showNotice]);

  const handleAddSweep = useCallback(() => {
    if (editingFeatureId) {
      const original = features.find((f) => f.id === editingFeatureId && f.type === "sweep") as
        | Extract<Feature, { type: "sweep" }>
        | undefined;
      if (!original) {
        setEditingFeatureId(null);
        setFeatureToolMode(null);
        return;
      }
      updateFeature(editingFeatureId, {
        ...original,
        pathFeatureId: sweepPathFeatureId ?? original.pathFeatureId,
        cut: sweepCut,
        label: `Varredura${sweepCut ? " (corte)" : ""}`,
      });
      setEditingFeatureId(null);
      setFeatureToolMode(null);
      showNotice("Varredura atualizada.");
      return;
    }

    if (!profile || !sweepPathFeatureId) return;
    if (sweepCut && !hasActiveSolid) {
      setErrorMessage("Não há sólido ativo para cortar — desmarque “Corte” ou crie um sólido primeiro.");
      return;
    }
    addFeature({
      id: createId(),
      type: "sweep",
      label: `Varredura${sweepCut ? " (corte)" : ""}`,
      profile,
      plane: activePlane,
      pathFeatureId: sweepPathFeatureId,
      cut: sweepCut,
    });
    clearSketch();
    clearProfileSelection();
    setEditingSketchId(null);
    setFeatureToolMode(null);
  }, [
    profile,
    sweepPathFeatureId,
    sweepCut,
    hasActiveSolid,
    activePlane,
    addFeature,
    clearSketch,
    clearProfileSelection,
    editingFeatureId,
    features,
    updateFeature,
    showNotice,
  ]);

  const handleAddHelix = useCallback(() => {
    if (editingFeatureId) {
      const original = features.find((f) => f.id === editingFeatureId && f.type === "helix") as
        | Extract<Feature, { type: "helix" }>
        | undefined;
      if (!original) {
        setEditingFeatureId(null);
        setFeatureToolMode(null);
        return;
      }
      updateFeature(editingFeatureId, {
        ...original,
        pitch: helixPitch,
        turns: helixTurns,
        reversed: helixReversed,
        cut: helixCut,
        label: `Espiral p${helixPitch}mm x${helixTurns}v${helixCut ? " (corte)" : ""}`,
      });
      setEditingFeatureId(null);
      setFeatureToolMode(null);
      showNotice("Espiral atualizada.");
      return;
    }

    if (!profile || !centerLine) return;
    if (helixCut && !hasActiveSolid) {
      setErrorMessage("Não há sólido ativo para cortar — desmarque “Corte” ou crie um sólido primeiro.");
      return;
    }
    addFeature({
      id: createId(),
      type: "helix",
      label: `Espiral p${helixPitch}mm x${helixTurns}v${helixCut ? " (corte)" : ""}`,
      profile,
      plane: activePlane,
      axisOrigin: centerLine.origin,
      axisDirection: centerLine.direction,
      pitch: helixPitch,
      turns: helixTurns,
      reversed: helixReversed,
      cut: helixCut,
    });
    clearSketch();
    clearProfileSelection();
    setEditingSketchId(null);
    setFeatureToolMode(null);
  }, [
    profile,
    centerLine,
    helixPitch,
    helixTurns,
    helixReversed,
    helixCut,
    hasActiveSolid,
    activePlane,
    addFeature,
    clearSketch,
    clearProfileSelection,
    editingFeatureId,
    features,
    updateFeature,
    showNotice,
  ]);

  const handleAddPatternRect = useCallback(() => {
    if (!patternSourceFeatureId) return;
    const dir1 = AXIS_VECTORS[patternDir1];
    const dir2 = patternDir2Enabled ? AXIS_VECTORS[patternDir2] : undefined;
    const label = `Padrão retangular (${patternCount1}${patternDir2Enabled ? `x${patternCount2}` : ""})`;

    if (editingFeatureId) {
      const original = features.find((f) => f.id === editingFeatureId && f.type === "pattern" && f.kind === "rectangular") as
        | Extract<Feature, { type: "pattern"; kind: "rectangular" }>
        | undefined;
      if (!original) {
        setEditingFeatureId(null);
        setFeatureToolMode(null);
        return;
      }
      updateFeature(editingFeatureId, {
        ...original,
        sourceFeatureId: patternSourceFeatureId,
        dir1,
        count1: patternCount1,
        spacing1: patternSpacing1,
        dir2,
        count2: patternDir2Enabled ? patternCount2 : undefined,
        spacing2: patternDir2Enabled ? patternSpacing2 : undefined,
        label,
      });
      setEditingFeatureId(null);
      setFeatureToolMode(null);
      showNotice("Padrão retangular atualizado.");
      return;
    }

    addFeature({
      id: createId(),
      type: "pattern",
      kind: "rectangular",
      label,
      sourceFeatureId: patternSourceFeatureId,
      dir1,
      count1: patternCount1,
      spacing1: patternSpacing1,
      dir2,
      count2: patternDir2Enabled ? patternCount2 : undefined,
      spacing2: patternDir2Enabled ? patternSpacing2 : undefined,
    });
    setFeatureToolMode(null);
    showNotice("Padrão retangular criado.");
  }, [
    patternSourceFeatureId,
    patternDir1,
    patternCount1,
    patternSpacing1,
    patternDir2Enabled,
    patternDir2,
    patternCount2,
    patternSpacing2,
    addFeature,
    editingFeatureId,
    features,
    updateFeature,
    showNotice,
  ]);

  const handleAddPatternCircular = useCallback(() => {
    if (!patternSourceFeatureId) return;
    const axis = patternAxisOptions.find((a) => a.id === patternAxisChoice);
    if (!axis) return;
    const label = `Padrão circular (${patternCount})`;

    if (editingFeatureId) {
      const original = features.find((f) => f.id === editingFeatureId && f.type === "pattern" && f.kind === "circular") as
        | Extract<Feature, { type: "pattern"; kind: "circular" }>
        | undefined;
      if (!original) {
        setEditingFeatureId(null);
        setFeatureToolMode(null);
        return;
      }
      updateFeature(editingFeatureId, {
        ...original,
        sourceFeatureId: patternSourceFeatureId,
        axisOrigin: axis.origin,
        axisDirection: axis.direction,
        count: patternCount,
        angle: patternAngle,
        label,
      });
      setEditingFeatureId(null);
      setFeatureToolMode(null);
      showNotice("Padrão circular atualizado.");
      return;
    }

    addFeature({
      id: createId(),
      type: "pattern",
      kind: "circular",
      label,
      sourceFeatureId: patternSourceFeatureId,
      axisOrigin: axis.origin,
      axisDirection: axis.direction,
      count: patternCount,
      angle: patternAngle,
    });
    setFeatureToolMode(null);
    showNotice("Padrão circular criado.");
  }, [
    patternSourceFeatureId,
    patternAxisChoice,
    patternAxisOptions,
    patternCount,
    patternAngle,
    addFeature,
    editingFeatureId,
    features,
    updateFeature,
    showNotice,
  ]);

  const handleLogout = useCallback(async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }, [router]);

  const handleSelectFolder = useCallback(async () => {
    if (!isFileSystemAccessSupported()) {
      showNotice("Este navegador não suporta escolher pasta (funciona no Chrome/Edge) — salvar continua funcionando por download.");
      return;
    }
    const handle = await pickProjectFolder();
    if (handle) {
      setProjectFolder(handle);
      showNotice(`Pasta do projeto: "${handle.name}".`);
    }
  }, [showNotice]);

  // "Salvar Como": sempre pergunta onde salvar (nome/pasta), mesmo que já
  // exista um arquivo aberto — e o resultado passa a ser o novo arquivo
  // "atual" pra próximos "Salvar". Sem File System Access, não tem como
  // escolher pasta de verdade, então só pergunta o nome via prompt e cai no
  // download de sempre.
  const handleSaveProjectAs = useCallback(async () => {
    const json = serializeProject(features, drawingSheets);
    const suggestedName = currentFileName ?? `projeto${NATIVE_FILE_EXTENSION}`;

    if (isFileSystemAccessSupported()) {
      const handle = await pickSaveFileHandle(suggestedName, [
        { description: "Projeto Eksteel", accept: { "application/json": [NATIVE_FILE_EXTENSION] } },
      ]);
      if (!handle) return;
      await writeToFileHandle(handle, json);
      setCurrentFileHandle(handle);
      setCurrentFileName(handle.name);
      showNotice(`"${handle.name}" salvo.`);
      return;
    }

    const filename = window.prompt("Salvar como (nome do arquivo):", suggestedName);
    if (!filename) return;
    const result = await saveOrDownload(projectFolder, json, filename);
    setCurrentFileHandle(null);
    setCurrentFileName(filename);
    showNotice(result === "folder" ? "Projeto salvo na pasta selecionada." : "Projeto baixado.");
  }, [features, drawingSheets, currentFileName, projectFolder, showNotice]);

  // "Salvar": grava direto no arquivo já aberto/salvo, sem perguntar nada —
  // é o que permite ir salvando à vontade enquanto edita sem risco de
  // perder trabalho. Só cai no fluxo de "Salvar Como" se ainda não existe
  // nenhum arquivo atual (nada em que salvar "dentro").
  const handleSaveProject = useCallback(async () => {
    if (!currentFileHandle) {
      await handleSaveProjectAs();
      return;
    }

    try {
      await writeToFileHandle(currentFileHandle, serializeProject(features, drawingSheets));
      showNotice(`"${currentFileHandle.name}" salvo.`);
    } catch {
      // Handle pode ter ficado inválido (arquivo movido/apagado fora do
      // app) — cai pro fluxo de escolher onde salvar de novo, em vez de
      // travar o salvamento.
      setCurrentFileHandle(null);
      await handleSaveProjectAs();
    }
  }, [features, drawingSheets, currentFileHandle, handleSaveProjectAs, showNotice]);

  // Ctrl+S salva no arquivo já aberto (ou pede onde salvar, na primeira
  // vez); Ctrl+Shift+S é "Salvar Como" — convenção padrão (Word, VSCode
  // etc). Ambos evitam cair no "salvar página" padrão do navegador.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const isMac = navigator.platform.toLowerCase().includes("mac");
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (!mod || e.key.toLowerCase() !== "s") return;
      e.preventDefault();
      if (e.shiftKey) {
        handleSaveProjectAs();
      } else {
        handleSaveProject();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleSaveProject, handleSaveProjectAs]);

  const handleOpenProject = useCallback(async () => {
    const picked = await pickFileToOpen([
      { description: "Projeto Eksteel", accept: { "application/json": [NATIVE_FILE_EXTENSION] } },
    ]);
    if (!picked) return;

    try {
      const loaded = parseProject(await picked.file.text());
      useFeatureStore.setState({ features: loaded.features });
      useDrawingStore.getState().loadSheets(loaded.drawingSheets);
      clearSketch();
      setEditingSketchId(null);
      setSketching(false);
      setPickingPlane(false);
      setCurrentFileHandle(picked.handle);
      setCurrentFileName(picked.file.name);
      showNotice(`Projeto "${picked.file.name}" aberto.`);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Erro ao abrir o projeto.");
    }
  }, [clearSketch, showNotice]);

  const handleExportStep = useCallback(async () => {
    if (!solidRef.current) return;
    const blob = solidRef.current.blobSTEP();
    const result = await saveOrDownload(projectFolder, blob, "modelo.step");
    showNotice(result === "folder" ? "STEP salvo na pasta selecionada." : "STEP baixado.");
  }, [projectFolder, showNotice]);

  const handleExportDxf = useCallback(async () => {
    if (!hasFinishedSketch) return;
    const blob = new Blob([buildDxf(shapes, points)], { type: "application/dxf" });
    const result = await saveOrDownload(projectFolder, blob, "esboco.dxf");
    showNotice(result === "folder" ? "DXF salvo na pasta selecionada." : "DXF baixado.");
  }, [hasFinishedSketch, shapes, points, projectFolder, showNotice]);

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex flex-wrap items-center gap-3 border-b border-chrome-border bg-chrome-bg px-4 py-2 text-chrome-text">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- next/image
              trava em runtime nesta página (conflito com o Canvas do
              react-three-fiber) — img simples resolve, e o arquivo já é
              pequeno o bastante pra não precisar da otimização do Next. */}
          <img
            src="/images/Eksteel-logo.png"
            alt="Eksteel"
            className="h-9 w-auto object-contain"
          />
          <div className="hidden h-7 w-px bg-chrome-border sm:block" />
          <span
            className="hidden text-sm font-semibold uppercase tracking-wide text-chrome-text-muted sm:inline"
            style={{ fontFamily: "var(--font-oswald)" }}
          >
            Modelador 3D
          </span>
        </div>
        {currentFileName && (
          <span
            className="max-w-[10rem] truncate text-sm font-medium text-chrome-text-muted"
            title={
              currentFileHandle
                ? `Salvando direto em "${currentFileName}"`
                : `${currentFileName} (baixa de novo a cada "Salvar" — navegador sem File System Access)`
            }
          >
            {currentFileName}
          </span>
        )}
        <span className="text-xs text-chrome-text-subtle">
          {sketching
            ? `Modo esboço — ${isBasePlane(activePlane) ? "plano XY" : "face selecionada"}`
            : "Modo modelo"}
        </span>
        {status === "loading" && (
          <span className="text-xs text-chrome-text-subtle">Gerando…</span>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={handleSelectFolder}
            title={projectFolder ? `Pasta do projeto: "${projectFolder.name}" (clique pra trocar)` : "Selecionar pasta do projeto (Chrome/Edge)"}
            className="max-w-[9rem] truncate rounded-lg px-2 py-1.5 text-xs text-chrome-text-muted hover:bg-chrome-surface-alt"
          >
            {projectFolder ? projectFolder.name : "Selecionar Pasta"}
          </button>
          <button
            type="button"
            onClick={handleOpenProject}
            title="Abrir projeto (.eks3d)"
            className="rounded-lg px-2 py-1.5 text-xs text-chrome-text-muted hover:bg-chrome-surface-alt"
          >
            Abrir
          </button>
          <button
            type="button"
            onClick={handleSaveProject}
            title={
              currentFileHandle
                ? `Salvar em "${currentFileHandle.name}" (Ctrl+S)`
                : "Salvar projeto no formato nativo (.eks3d) (Ctrl+S)"
            }
            className="rounded-lg px-2 py-1.5 text-xs text-chrome-text-muted hover:bg-chrome-surface-alt"
          >
            Salvar
          </button>
          <button
            type="button"
            onClick={handleSaveProjectAs}
            title="Salvar como um novo arquivo (Ctrl+Shift+S)"
            className="rounded-lg px-2 py-1.5 text-xs text-chrome-text-muted hover:bg-chrome-surface-alt"
          >
            Salvar Como
          </button>
          <button
            type="button"
            onClick={handleExportStep}
            disabled={!hasActiveSolid}
            title={hasActiveSolid ? "Exportar o modelo como STEP" : "Crie um sólido antes de exportar"}
            className="rounded-lg px-2 py-1.5 text-xs text-chrome-text-muted hover:bg-chrome-surface-alt disabled:cursor-not-allowed disabled:opacity-40"
          >
            STEP
          </button>
          <button
            type="button"
            onClick={handleExportDxf}
            disabled={!hasFinishedSketch}
            title={hasFinishedSketch ? "Exportar o esboço atual como DXF" : "Desenhe um esboço antes de exportar"}
            className="rounded-lg px-2 py-1.5 text-xs text-chrome-text-muted hover:bg-chrome-surface-alt disabled:cursor-not-allowed disabled:opacity-40"
          >
            DXF
          </button>
          <div className="mx-1 hidden h-6 w-px bg-chrome-border sm:block" />
          <div className="flex items-center gap-0.5 rounded-lg bg-chrome-surface-alt p-0.5">
            <button
              type="button"
              onClick={() => setMode("modelar")}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                mode === "modelar" ? "bg-primary text-primary-foreground" : "text-chrome-text-muted hover:bg-chrome-border"
              }`}
            >
              Modelador
            </button>
            <button
              type="button"
              onClick={() => setMode("desenho")}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                mode === "desenho" ? "bg-primary text-primary-foreground" : "text-chrome-text-muted hover:bg-chrome-border"
              }`}
            >
              Desenho
            </button>
          </div>
          <div className="mx-1 hidden h-6 w-px bg-chrome-border sm:block" />
          <button
            type="button"
            onClick={undoModel}
            disabled={!canUndo}
            title="Desfazer (Ctrl+Z)"
            className="rounded-lg p-1.5 text-chrome-text-muted hover:bg-chrome-surface-alt disabled:cursor-not-allowed disabled:opacity-30"
          >
            <IconUndo />
          </button>
          <button
            type="button"
            onClick={redoModel}
            disabled={!canRedo}
            title="Refazer (Ctrl+Y)"
            className="rounded-lg p-1.5 text-chrome-text-muted hover:bg-chrome-surface-alt disabled:cursor-not-allowed disabled:opacity-30"
          >
            <IconRedo />
          </button>
          {userEmail && (
            <div className="ml-1 flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 py-1 pl-3 pr-1 backdrop-blur-sm">
              <span className="max-w-[10rem] truncate text-xs font-semibold text-chrome-text-muted">
                {userEmail}
              </span>
              <button
                type="button"
                onClick={handleLogout}
                title="Sair da conta"
                className="flex items-center gap-1.5 rounded-xl border border-chrome-border bg-chrome-surface-alt px-2.5 py-1.5 text-xs font-semibold text-chrome-text-muted transition hover:bg-chrome-border"
              >
                <IconLogout />
                Sair
              </button>
            </div>
          )}
        </div>
      </header>

      {mode === "desenho" ? (
        <DrawingSheetWorkspace />
      ) : (
        <>
      {/* Altura ajustável (arraste a divisória logo abaixo) — sem isso, o
          modo "ocioso" (que empilha Extrudar+Face+Revolucionar+Furo+Split/
          Fillet/Chanfro+Plano/Eixo+Chapa juntos, cada um com seus próprios
          campos) podia quebrar em 5-7 linhas e empurrar a área 3D quase pra
          fora da tela. O scroll-y entra em ação quando o conteúdo passa da
          altura ajustada — os outros modos (escolher plano, esboçando,
          arestas etc.) já são compactos e raramente chegam perto do limite. */}
      <div
        style={{ height: toolbarHeight }}
        className="flex flex-wrap items-start gap-x-4 gap-y-1.5 overflow-y-auto border-b border-primary-100 bg-primary-50 px-4 py-1.5 text-sm">
        {pickingPlane ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <span className="shrink-0 text-primary-700">Escolha um plano:</span>
            {STANDARD_PLANES.map(({ id, label, plane }) => (
              <button
                key={id}
                type="button"
                onClick={() => handleUseStandardPlane(plane)}
                className="shrink-0 rounded-lg bg-white px-3 py-1.5 font-semibold text-primary-700 hover:bg-primary-100"
              >
                {label}
              </button>
            ))}
            {features
              .filter((f): f is Extract<Feature, { type: "plane" }> => f.type === "plane")
              .map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => handleUseStandardPlane(f.plane)}
                  className="shrink-0 rounded-lg bg-white px-3 py-1.5 font-semibold text-amber-700 hover:bg-primary-100"
                >
                  {f.label}
                </button>
              ))}
            <span className="shrink-0 text-xs text-primary-500">
              ou clique num plano/face no visualizador 3D
            </span>
            <button
              type="button"
              onClick={() => setPickingPlane(false)}
              className="shrink-0 rounded-lg bg-white px-3 py-1.5 text-primary-500 hover:bg-primary-100"
            >
              Cancelar
            </button>
          </div>
        ) : creatingPlane && !planeBase ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <span className="shrink-0 text-primary-700">Escolha a referência do novo plano:</span>
            {STANDARD_PLANES.map(({ id, label, plane }) => (
              <button
                key={id}
                type="button"
                onClick={() => handleStandardPlanePicked(plane)}
                className="shrink-0 rounded-lg bg-white px-3 py-1.5 font-semibold text-primary-700 hover:bg-primary-100"
              >
                {label}
              </button>
            ))}
            <span className="shrink-0 text-xs text-primary-500">ou clique num plano/face no visualizador 3D</span>
            <button
              type="button"
              onClick={handleCancelPlane}
              className="shrink-0 rounded-lg bg-white px-3 py-1.5 text-primary-500 hover:bg-primary-100"
            >
              Cancelar
            </button>
          </div>
        ) : creatingPlane && planeBase ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {editingFeatureId && <span className="shrink-0 font-semibold text-primary-800">Editando Plano</span>}
            <span className="shrink-0 text-primary-700">
              Arraste o plano amarelo no 3D ou digite o deslocamento:
            </span>
            <label className="flex shrink-0 items-center gap-1.5 text-primary-700">
              <input
                type="number"
                step={1}
                value={planeOffset}
                onChange={(e) => setPlaneOffset(Number(e.target.value))}
                className="w-20 rounded-lg border border-primary-200 bg-white px-2 py-1 text-foreground"
              />
              mm
            </label>
            <button
              type="button"
              onClick={handleConfirmPlane}
              className="shrink-0 rounded-lg bg-primary px-3 py-1.5 font-semibold text-primary-foreground hover:bg-primary-hover"
            >
              {editingFeatureId ? "Salvar Plano" : "Criar Plano"}
            </button>
            <button
              type="button"
              onClick={() => {
                handleCancelPlane();
                handleCancelEditingFeature();
              }}
              className="shrink-0 rounded-lg bg-white px-3 py-1.5 text-primary-500 hover:bg-primary-100"
            >
              Cancelar
            </button>
          </div>
        ) : pickingAxisFace ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <span className="shrink-0 text-primary-700">Escolha um eixo:</span>
            {STANDARD_AXES.map((axis) => (
              <button
                key={axis.id}
                type="button"
                onClick={() => handleUseStandardAxis(axis)}
                className="shrink-0 rounded-lg bg-white px-3 py-1.5 font-semibold text-primary-700 hover:bg-primary-100"
              >
                {axis.label}
              </button>
            ))}
            <span className="shrink-0 text-xs text-primary-500">
              ou clique numa face cilíndrica (parede de um furo) ou plana no 3D
            </span>
            <button
              type="button"
              onClick={() => setPickingAxisFace(false)}
              className="shrink-0 rounded-lg bg-white px-3 py-1.5 text-primary-500 hover:bg-primary-100"
            >
              Cancelar
            </button>
          </div>
        ) : edgeToolMode ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <span className="shrink-0 text-primary-700">
              {editingFeatureId
                ? `Editando ${edgeToolMode === "fillet" ? "arredondamento" : "chanfro"} (${selectedEdgePoints.length} aresta${selectedEdgePoints.length === 1 ? "" : "s"})`
                : `${edgeToolMode === "fillet" ? "Arredondar" : "Chanfrar"} — clique nas arestas no 3D (${selectedEdgePoints.length} escolhida${selectedEdgePoints.length === 1 ? "" : "s"})`}
              :
            </span>
            <label className="flex shrink-0 items-center gap-1.5 text-primary-700">
              {edgeToolMode === "fillet" ? "Raio" : "Distância"}
              <input
                type="number"
                min={0.1}
                step={0.5}
                value={edgeToolMode === "fillet" ? filletRadius3d : chamferDistance3d}
                onChange={(e) =>
                  edgeToolMode === "fillet"
                    ? setFilletRadius3d(Number(e.target.value))
                    : setChamferDistance3d(Number(e.target.value))
                }
                className="w-16 rounded-lg border border-primary-200 bg-white px-2 py-1 text-foreground"
              />
              mm
            </label>
            <button
              type="button"
              onClick={handleConfirmEdgeTool}
              disabled={selectedEdgePoints.length === 0}
              className="shrink-0 rounded-lg bg-primary px-3 py-1.5 font-semibold text-primary-foreground hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {editingFeatureId ? "Salvar" : edgeToolMode === "fillet" ? "Arredondar" : "Chanfrar"}
            </button>
            <button
              type="button"
              onClick={() => {
                handleCancelEdgeTool();
                handleCancelEditingFeature();
              }}
              className="shrink-0 rounded-lg bg-white px-3 py-1.5 text-primary-500 hover:bg-primary-100"
            >
              Cancelar
            </button>
          </div>
        ) : creatingSheetMetal ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <span className="shrink-0 font-semibold text-primary-800">
              {editingFeatureId ? "Editando Chapa" : "Virar Chapa"}
            </span>
            <label className="flex shrink-0 items-center gap-1.5 text-primary-700">
              Espessura
              <input
                type="number"
                min={0.1}
                step={0.1}
                value={newSheetThickness}
                onChange={(e) => setNewSheetThickness(Number(e.target.value))}
                className="w-16 rounded-lg border border-primary-200 bg-white px-2 py-1 text-foreground"
              />
              mm
            </label>
            <button
              type="button"
              onClick={handleConfirmSheetMetal}
              className="shrink-0 rounded-lg bg-primary px-3 py-1.5 font-semibold text-primary-foreground hover:bg-primary-hover"
            >
              {editingFeatureId ? "Salvar" : "Virar Chapa"}
            </button>
            <button
              type="button"
              onClick={handleCancelSheetMetal}
              className="shrink-0 rounded-lg bg-white px-3 py-1.5 text-primary-500 hover:bg-primary-100"
            >
              Cancelar
            </button>
          </div>
        ) : flangePicking ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {!flangeCandidate ? (
              <>
                <span className="shrink-0 text-primary-700">Flange — clique numa aresta reta da chapa no 3D</span>
                <button
                  type="button"
                  onClick={handleCancelFlange}
                  className="shrink-0 rounded-lg bg-white px-3 py-1.5 text-primary-500 hover:bg-primary-100"
                >
                  Cancelar
                </button>
              </>
            ) : (
              <>
                {editingFeatureId && <span className="shrink-0 font-semibold text-primary-800">Editando Flange</span>}
                <label className="flex shrink-0 items-center gap-1.5 text-primary-700">
                  Comprimento
                  <input
                    type="number"
                    min={0.1}
                    step={1}
                    value={flangeLength}
                    onChange={(e) => setFlangeLength(Number(e.target.value))}
                    className="w-16 rounded-lg border border-primary-200 bg-white px-2 py-1 text-foreground"
                  />
                  mm
                </label>
                <label className="flex shrink-0 items-center gap-1.5 text-primary-700">
                  Ângulo
                  <input
                    type="number"
                    min={1}
                    max={180}
                    step={1}
                    value={flangeAngle}
                    onChange={(e) => setFlangeAngle(Number(e.target.value))}
                    className="w-16 rounded-lg border border-primary-200 bg-white px-2 py-1 text-foreground"
                  />
                  °
                </label>
                <span
                  className="text-xs text-primary-500"
                  title="Raio interno = espessura da chapa, externo = 2x — calculado automático, não é escolhido por Flange"
                >
                  Raio: {sheetMetalFeature?.thickness}mm (auto)
                </span>
                <button
                  type="button"
                  onClick={handleConfirmFlange}
                  className="shrink-0 rounded-lg bg-primary px-3 py-1.5 font-semibold text-primary-foreground hover:bg-primary-hover"
                >
                  {editingFeatureId ? "Salvar Flange" : "Criar Flange"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    handleCancelFlange();
                    handleCancelEditingFeature();
                  }}
                  className="shrink-0 rounded-lg bg-white px-3 py-1.5 text-primary-500 hover:bg-primary-100"
                >
                  Cancelar
                </button>
              </>
            )}
          </div>
        ) : sketching ? (
          <>
            <button
              type="button"
              onClick={handleFinishSketch}
              className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary-800 px-3 py-1.5 font-semibold text-white transition hover:bg-primary-900"
            >
              <IconFinish />
              Concluir Esboço
            </button>
            <div className="hidden h-6 w-px shrink-0 bg-primary-200 sm:block" />
            <SketchToolPalette />
          </>
        ) : (
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={handleCreateSketch}
              className="flex items-center gap-1.5 rounded-lg bg-primary-800 px-3 py-1.5 font-semibold text-white transition hover:bg-primary-900"
            >
              <IconSketch />
              Criar Esboço
            </button>
            {hasFinishedSketch && (
              <button
                type="button"
                onClick={handleEditSketch}
                className="rounded-lg bg-white px-3 py-1.5 text-primary-700 hover:bg-primary-100"
              >
                Editar Esboço
              </button>
            )}
          </div>
        )}

        {!sketching && !pickingPlane && !creatingPlane && !pickingAxisFace && !edgeToolMode && !flangePicking && !creatingSheetMetal && (
          <>
            <div className="hidden h-6 w-px shrink-0 bg-primary-200 sm:block" />

            {/* Ao estilo Inventor: clicar num ícone abre uma "telinha" só com
                os campos daquela ferramenta (featureToolMode), em vez de
                mostrar Extrudar+Face+Revolucionar+Furo+Cortar por Plano
                todos ao mesmo tempo com todos os campos — isso sozinho já
                era a maior fonte de altura da barra. Fillet/Chamfer/Plano/
                Eixo/Chapa continuam na grade ociosa (já são compactos, e
                Fillet/Chamfer já abrem sua própria telinha de escolha de
                aresta ao clicar — ver edgeToolMode acima). */}
            {featureToolMode === "extrude" ? (
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <span className="shrink-0 font-semibold text-primary-800">{editingFeatureId ? "Editando Extrudar" : "Extrudar"}</span>
                <label className="flex items-center gap-1.5 text-primary-700">
                  Profundidade
                  <input
                    type="number"
                    min={0.1}
                    step={1}
                    value={extrudeDepth}
                    onChange={(e) => setExtrudeDepth(Number(e.target.value))}
                    className="w-16 rounded-lg border border-primary-200 bg-white px-2 py-1 text-foreground"
                  />
                </label>
                <label className="flex items-center gap-1.5 text-primary-700">
                  <input
                    type="checkbox"
                    checked={extrudeCut}
                    onChange={(e) => setExtrudeCut(e.target.checked)}
                  />
                  Corte
                </label>
                <div className="flex items-center gap-0.5 rounded-lg bg-white p-0.5" title="Sentido da extrusão">
                  {(
                    [
                      { id: "normal" as const, arrow: "→", title: "Seguindo a normal do plano" },
                      { id: "flipped" as const, arrow: "←", title: "Sentido invertido" },
                      { id: "symmetric" as const, arrow: "↔", title: "Simétrico (metade pra cada lado)" },
                    ]
                  ).map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => setExtrudeDirection(d.id)}
                      title={d.title}
                      className={`rounded px-2 py-1 ${
                        extrudeDirection === d.id ? "bg-primary text-primary-foreground" : "text-primary-700 hover:bg-primary-100"
                      }`}
                    >
                      {d.arrow}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={handleAddExtrude}
                  disabled={editingFeatureId ? false : !profile}
                  className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 font-semibold text-primary-foreground transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <IconExtrude />
                  {editingFeatureId ? "Salvar" : "Extrudar"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFeatureToolMode(null);
                    handleCancelEditingFeature();
                  }}
                  className="shrink-0 rounded-lg bg-white px-3 py-1.5 text-primary-500 hover:bg-primary-100"
                >
                  Cancelar
                </button>
              </div>
            ) : featureToolMode === "face" ? (
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <span className="shrink-0 font-semibold text-primary-800">{editingFeatureId ? "Editando Face" : "Face"}</span>
                <label className="flex items-center gap-1.5 text-primary-700">
                  <input
                    type="checkbox"
                    checked={faceCut}
                    onChange={(e) => setFaceCut(e.target.checked)}
                  />
                  Corte
                </label>
                <div className="flex items-center gap-0.5 rounded-lg bg-white p-0.5" title="Sentido da Face">
                  {(
                    [
                      { id: "normal" as const, arrow: "→", title: "Seguindo a normal do plano" },
                      { id: "flipped" as const, arrow: "←", title: "Sentido invertido" },
                      { id: "symmetric" as const, arrow: "↔", title: "Simétrico (metade pra cada lado)" },
                    ]
                  ).map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => setFaceDirection(d.id)}
                      title={d.title}
                      className={`rounded px-2 py-1 ${
                        faceDirection === d.id ? "bg-primary text-primary-foreground" : "text-primary-700 hover:bg-primary-100"
                      }`}
                    >
                      {d.arrow}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={handleAddFace}
                  disabled={editingFeatureId ? false : !profile}
                  title={
                    faceCut
                      ? `Recorta a chapa com o perfil, na espessura ativa (${sheetMetalFeature?.thickness}mm)`
                      : `Extrude do perfil na espessura da chapa (${sheetMetalFeature?.thickness}mm)`
                  }
                  className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 font-semibold text-primary-foreground transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {editingFeatureId ? "Salvar" : faceCut ? "Cortar" : "Face"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFeatureToolMode(null);
                    handleCancelEditingFeature();
                  }}
                  className="shrink-0 rounded-lg bg-white px-3 py-1.5 text-primary-500 hover:bg-primary-100"
                >
                  Cancelar
                </button>
              </div>
            ) : featureToolMode === "revolve" ? (
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <span className="shrink-0 font-semibold text-primary-800">{editingFeatureId ? "Editando Revolucionar" : "Revolucionar"}</span>
                <span
                  className={`text-xs ${centerLine ? "text-primary-500" : "text-primary-400"}`}
                  title="Desenhe uma Linha de Centro no sketch pra definir o eixo — sem ela, Revolucionar fica desabilitado."
                >
                  {centerLine ? "Eixo: linha de centro definida" : "Eixo: sem linha de centro"}
                </span>
                <label className="flex items-center gap-1.5 text-primary-700">
                  Ângulo
                  <input
                    type="number"
                    min={1}
                    max={360}
                    step={1}
                    value={revolveAngle}
                    onChange={(e) => setRevolveAngle(Number(e.target.value))}
                    className="w-16 rounded-lg border border-primary-200 bg-white px-2 py-1 text-foreground"
                  />
                </label>
                <div className="flex items-center gap-0.5 rounded-lg bg-white p-0.5" title="Sentido de rotação">
                  {(
                    [
                      { value: false, symbol: "↻", title: "Sentido padrão" },
                      { value: true, symbol: "↺", title: "Sentido invertido" },
                    ]
                  ).map((d) => (
                    <button
                      key={String(d.value)}
                      type="button"
                      onClick={() => setRevolveReversed(d.value)}
                      title={d.title}
                      className={`rounded px-2 py-1 ${
                        revolveReversed === d.value ? "bg-primary text-primary-foreground" : "text-primary-700 hover:bg-primary-100"
                      }`}
                    >
                      {d.symbol}
                    </button>
                  ))}
                </div>
                <label className="flex items-center gap-1.5 text-primary-700">
                  <input
                    type="checkbox"
                    checked={revolveCut}
                    onChange={(e) => setRevolveCut(e.target.checked)}
                  />
                  Corte
                </label>
                <button
                  type="button"
                  onClick={handleAddRevolve}
                  disabled={editingFeatureId ? false : !profile || !centerLine}
                  title={
                    !editingFeatureId && !centerLine
                      ? "Desenhe uma Linha de Centro no sketch antes de revolucionar"
                      : undefined
                  }
                  className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 font-semibold text-primary-foreground transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <IconRevolve />
                  {editingFeatureId ? "Salvar" : "Revolucionar"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFeatureToolMode(null);
                    handleCancelEditingFeature();
                  }}
                  className="shrink-0 rounded-lg bg-white px-3 py-1.5 text-primary-500 hover:bg-primary-100"
                >
                  Cancelar
                </button>
              </div>
            ) : featureToolMode === "hole" ? (
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <span className="shrink-0 font-semibold text-primary-800">{editingFeatureId ? "Editando Furo" : "Furo"}</span>
                <label className="flex items-center gap-1.5 text-primary-700">
                  <input
                    type="checkbox"
                    checked={holeThrough}
                    onChange={(e) => setHoleThrough(e.target.checked)}
                  />
                  Passante
                </label>
                <label className="flex items-center gap-1.5 text-primary-700">
                  Profundidade
                  <input
                    type="number"
                    min={0.1}
                    step={1}
                    value={holeDepth}
                    disabled={holeThrough}
                    onChange={(e) => setHoleDepth(Number(e.target.value))}
                    className="w-16 rounded-lg border border-primary-200 bg-white px-2 py-1 text-foreground disabled:opacity-40"
                  />
                </label>
                <div
                  className="flex items-center gap-0.5 rounded-lg bg-white p-0.5 disabled:opacity-40"
                  title={holeThrough ? "Sentido não se aplica a furo passante" : "Sentido do furo"}
                >
                  {(
                    [
                      { id: "normal" as const, arrow: "→", title: "Seguindo a normal do plano" },
                      { id: "flipped" as const, arrow: "←", title: "Sentido invertido (padrão)" },
                    ]
                  ).map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => setHoleDirection(d.id)}
                      disabled={holeThrough}
                      title={d.title}
                      className={`rounded px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40 ${
                        holeDirection === d.id ? "bg-primary text-primary-foreground" : "text-primary-700 hover:bg-primary-100"
                      }`}
                    >
                      {d.arrow}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={handleAddHole}
                  disabled={editingFeatureId ? false : holeCircles.length === 0 || !hasActiveSolid}
                  title={
                    !editingFeatureId && !hasActiveSolid
                      ? "Extrude ou revolucione um sólido antes de furar"
                      : undefined
                  }
                  className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 font-semibold text-primary-foreground transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <IconHole />
                  {editingFeatureId ? "Salvar" : "Furo"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFeatureToolMode(null);
                    handleCancelEditingFeature();
                  }}
                  className="shrink-0 rounded-lg bg-white px-3 py-1.5 text-primary-500 hover:bg-primary-100"
                >
                  Cancelar
                </button>
              </div>
            ) : featureToolMode === "split" ? (
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <span className="shrink-0 font-semibold text-primary-800">{editingFeatureId ? "Editando Cortar por Plano" : "Cortar por Plano"}</span>
                <label className="flex items-center gap-1.5 text-primary-700">
                  Lado a manter
                  <select
                    value={splitKeepSide}
                    onChange={(e) => setSplitKeepSide(e.target.value as "positive" | "negative")}
                    className="rounded-lg border border-primary-200 bg-white px-2 py-1 text-foreground"
                  >
                    <option value="positive">+ (a favor da normal)</option>
                    <option value="negative">- (contra a normal)</option>
                  </select>
                </label>
                <button
                  type="button"
                  onClick={handleAddSplit}
                  disabled={editingFeatureId ? false : !hasActiveSolid}
                  title={!editingFeatureId && !hasActiveSolid ? "Crie um sólido antes de cortar por plano" : undefined}
                  className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 font-semibold text-primary-foreground transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <IconSplit />
                  {editingFeatureId ? "Salvar" : "Cortar por Plano"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFeatureToolMode(null);
                    handleCancelEditingFeature();
                  }}
                  className="shrink-0 rounded-lg bg-white px-3 py-1.5 text-primary-500 hover:bg-primary-100"
                >
                  Cancelar
                </button>
              </div>
            ) : featureToolMode === "sweep" ? (
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <span className="shrink-0 font-semibold text-primary-800">{editingFeatureId ? "Editando Varredura" : "Varredura"}</span>
                <label className="flex items-center gap-1.5 text-primary-700">
                  Caminho
                  <select
                    value={sweepPathFeatureId ?? ""}
                    onChange={(e) => setSweepPathFeatureId(e.target.value || null)}
                    className="rounded-lg border border-primary-200 bg-white px-2 py-1 text-foreground"
                  >
                    <option value="">Escolha um esboço salvo</option>
                    {pathSketchOptions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-1.5 text-primary-700">
                  <input type="checkbox" checked={sweepCut} onChange={(e) => setSweepCut(e.target.checked)} />
                  Corte
                </label>
                <button
                  type="button"
                  onClick={handleAddSweep}
                  disabled={editingFeatureId ? false : !profile || !sweepPathFeatureId}
                  title={pathSketchOptions.length === 0 ? "Conclua outro esboço (o caminho) antes de usar Varredura" : undefined}
                  className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 font-semibold text-primary-foreground transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <IconSweep />
                  {editingFeatureId ? "Salvar" : "Varredura"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFeatureToolMode(null);
                    handleCancelEditingFeature();
                  }}
                  className="shrink-0 rounded-lg bg-white px-3 py-1.5 text-primary-500 hover:bg-primary-100"
                >
                  Cancelar
                </button>
              </div>
            ) : featureToolMode === "helix" ? (
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <span className="shrink-0 font-semibold text-primary-800">{editingFeatureId ? "Editando Espiral" : "Espiral"}</span>
                <span
                  className={`text-xs ${centerLine ? "text-primary-500" : "text-primary-400"}`}
                  title="Desenhe uma Linha de Centro no sketch pra definir o eixo — sem ela, Espiral fica desabilitada."
                >
                  {centerLine ? "Eixo: linha de centro definida" : "Eixo: sem linha de centro"}
                </span>
                <label className="flex items-center gap-1.5 text-primary-700">
                  Passo
                  <input
                    type="number"
                    min={0.1}
                    step={0.5}
                    value={helixPitch}
                    onChange={(e) => setHelixPitch(Number(e.target.value))}
                    className="w-16 rounded-lg border border-primary-200 bg-white px-2 py-1 text-foreground"
                  />
                  mm
                </label>
                <label className="flex items-center gap-1.5 text-primary-700">
                  Voltas
                  <input
                    type="number"
                    min={0.25}
                    step={0.25}
                    value={helixTurns}
                    onChange={(e) => setHelixTurns(Number(e.target.value))}
                    className="w-16 rounded-lg border border-primary-200 bg-white px-2 py-1 text-foreground"
                  />
                </label>
                <div className="flex items-center gap-0.5 rounded-lg bg-white p-0.5" title="Sentido da hélice">
                  {(
                    [
                      { value: false, symbol: "↻", title: "Sentido padrão" },
                      { value: true, symbol: "↺", title: "Sentido invertido" },
                    ]
                  ).map((d) => (
                    <button
                      key={String(d.value)}
                      type="button"
                      onClick={() => setHelixReversed(d.value)}
                      title={d.title}
                      className={`rounded px-2 py-1 ${
                        helixReversed === d.value ? "bg-primary text-primary-foreground" : "text-primary-700 hover:bg-primary-100"
                      }`}
                    >
                      {d.symbol}
                    </button>
                  ))}
                </div>
                <label className="flex items-center gap-1.5 text-primary-700">
                  <input type="checkbox" checked={helixCut} onChange={(e) => setHelixCut(e.target.checked)} />
                  Corte
                </label>
                <button
                  type="button"
                  onClick={handleAddHelix}
                  disabled={editingFeatureId ? false : !profile || !centerLine}
                  title={!editingFeatureId && !centerLine ? "Desenhe uma Linha de Centro no sketch antes de usar Espiral" : undefined}
                  className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 font-semibold text-primary-foreground transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <IconHelix />
                  {editingFeatureId ? "Salvar" : "Espiral"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFeatureToolMode(null);
                    handleCancelEditingFeature();
                  }}
                  className="shrink-0 rounded-lg bg-white px-3 py-1.5 text-primary-500 hover:bg-primary-100"
                >
                  Cancelar
                </button>
              </div>
            ) : featureToolMode === "patternRect" ? (
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <span className="shrink-0 font-semibold text-primary-800">
                  {editingFeatureId ? "Editando Padrão Retangular" : "Padrão Retangular"}
                </span>
                <label className="flex items-center gap-1.5 text-primary-700">
                  Origem
                  <select
                    value={patternSourceFeatureId ?? ""}
                    onChange={(e) => setPatternSourceFeatureId(e.target.value || null)}
                    className="rounded-lg border border-primary-200 bg-white px-2 py-1 text-foreground"
                  >
                    <option value="">Escolha uma feature</option>
                    {patternableFeatures.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-1.5 text-primary-700">
                  Direção 1
                  <select
                    value={patternDir1}
                    onChange={(e) => setPatternDir1(e.target.value as "x" | "y" | "z")}
                    className="rounded-lg border border-primary-200 bg-white px-1.5 py-1 text-foreground"
                  >
                    <option value="x">X</option>
                    <option value="y">Y</option>
                    <option value="z">Z</option>
                  </select>
                </label>
                <label className="flex items-center gap-1.5 text-primary-700">
                  Qtd.
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={patternCount1}
                    onChange={(e) => setPatternCount1(Number(e.target.value))}
                    className="w-14 rounded-lg border border-primary-200 bg-white px-2 py-1 text-foreground"
                  />
                </label>
                <label className="flex items-center gap-1.5 text-primary-700">
                  Espaço
                  <input
                    type="number"
                    step={1}
                    value={patternSpacing1}
                    onChange={(e) => setPatternSpacing1(Number(e.target.value))}
                    className="w-16 rounded-lg border border-primary-200 bg-white px-2 py-1 text-foreground"
                  />
                  mm
                </label>
                <label className="flex items-center gap-1.5 text-primary-700">
                  <input type="checkbox" checked={patternDir2Enabled} onChange={(e) => setPatternDir2Enabled(e.target.checked)} />
                  2ª direção
                </label>
                {patternDir2Enabled && (
                  <>
                    <select
                      value={patternDir2}
                      onChange={(e) => setPatternDir2(e.target.value as "x" | "y" | "z")}
                      className="rounded-lg border border-primary-200 bg-white px-1.5 py-1 text-foreground"
                    >
                      <option value="x">X</option>
                      <option value="y">Y</option>
                      <option value="z">Z</option>
                    </select>
                    <label className="flex items-center gap-1.5 text-primary-700">
                      Qtd.
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={patternCount2}
                        onChange={(e) => setPatternCount2(Number(e.target.value))}
                        className="w-14 rounded-lg border border-primary-200 bg-white px-2 py-1 text-foreground"
                      />
                    </label>
                    <label className="flex items-center gap-1.5 text-primary-700">
                      Espaço
                      <input
                        type="number"
                        step={1}
                        value={patternSpacing2}
                        onChange={(e) => setPatternSpacing2(Number(e.target.value))}
                        className="w-16 rounded-lg border border-primary-200 bg-white px-2 py-1 text-foreground"
                      />
                      mm
                    </label>
                  </>
                )}
                <button
                  type="button"
                  onClick={handleAddPatternRect}
                  disabled={!patternSourceFeatureId}
                  className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 font-semibold text-primary-foreground transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <IconPatternRect />
                  {editingFeatureId ? "Salvar" : "Padrão"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFeatureToolMode(null);
                    handleCancelEditingFeature();
                  }}
                  className="shrink-0 rounded-lg bg-white px-3 py-1.5 text-primary-500 hover:bg-primary-100"
                >
                  Cancelar
                </button>
              </div>
            ) : featureToolMode === "patternCircular" ? (
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <span className="shrink-0 font-semibold text-primary-800">
                  {editingFeatureId ? "Editando Padrão Circular" : "Padrão Circular"}
                </span>
                <label className="flex items-center gap-1.5 text-primary-700">
                  Origem
                  <select
                    value={patternSourceFeatureId ?? ""}
                    onChange={(e) => setPatternSourceFeatureId(e.target.value || null)}
                    className="rounded-lg border border-primary-200 bg-white px-2 py-1 text-foreground"
                  >
                    <option value="">Escolha uma feature</option>
                    {patternableFeatures.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-1.5 text-primary-700">
                  Eixo
                  <select
                    value={patternAxisChoice}
                    onChange={(e) => setPatternAxisChoice(e.target.value)}
                    className="rounded-lg border border-primary-200 bg-white px-2 py-1 text-foreground"
                  >
                    {patternAxisOptions.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-1.5 text-primary-700">
                  Qtd.
                  <input
                    type="number"
                    min={2}
                    step={1}
                    value={patternCount}
                    onChange={(e) => setPatternCount(Number(e.target.value))}
                    className="w-14 rounded-lg border border-primary-200 bg-white px-2 py-1 text-foreground"
                  />
                </label>
                <label className="flex items-center gap-1.5 text-primary-700">
                  Ângulo total
                  <input
                    type="number"
                    min={1}
                    max={360}
                    step={1}
                    value={patternAngle}
                    onChange={(e) => setPatternAngle(Number(e.target.value))}
                    className="w-16 rounded-lg border border-primary-200 bg-white px-2 py-1 text-foreground"
                  />
                  °
                </label>
                <button
                  type="button"
                  onClick={handleAddPatternCircular}
                  disabled={!patternSourceFeatureId}
                  className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 font-semibold text-primary-foreground transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <IconPatternCircular />
                  {editingFeatureId ? "Salvar" : "Padrão"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFeatureToolMode(null);
                    handleCancelEditingFeature();
                  }}
                  className="shrink-0 rounded-lg bg-white px-3 py-1.5 text-primary-500 hover:bg-primary-100"
                >
                  Cancelar
                </button>
              </div>
            ) : (
              <div className="flex shrink-0 flex-wrap items-start gap-1.5">
                {multiProfileSelection.length > 0 && (
                  <span className="flex shrink-0 items-center gap-1.5 self-center rounded-lg bg-[#8e24aa]/10 px-2.5 py-1 text-[#8e24aa]" title="Ctrl+clique numa forma do esboço pra somar/tirar da seleção">
                    {selectedProfileCount} perfis selecionados
                    <button
                      type="button"
                      onClick={clearProfileSelection}
                      className="font-semibold underline hover:no-underline"
                    >
                      Limpar
                    </button>
                  </span>
                )}
                <FeaturePanel label="Criar">
                  {!isSheetMetal && (
                    <FeatureToolButton
                      icon={IconExtrude}
                      label="Extrudar"
                      onClick={() => setFeatureToolMode("extrude")}
                      disabled={!profile}
                    />
                  )}
                  {isSheetMetal && (
                    <FeatureToolButton
                      icon={IconFace}
                      label="Face"
                      onClick={() => setFeatureToolMode("face")}
                      disabled={!profile}
                      title={`Extrude/recorta na espessura da chapa (${sheetMetalFeature?.thickness}mm)`}
                    />
                  )}
                  {/* Revolucionar/Varredura fazem sólidos livres (perfil
                      girado/varrido), incompatíveis com uma peça que virou
                      chapa (sempre a mesma espessura constante, só Face/
                      Flange fazem sentido) — escondidos nesse caso. */}
                  {!isSheetMetal && (
                    <FeatureToolButton
                      icon={IconRevolve}
                      label="Revolucionar"
                      onClick={() => setFeatureToolMode("revolve")}
                      disabled={!profile || !centerLine}
                      title={!centerLine ? "Desenhe uma Linha de Centro no sketch antes de revolucionar" : "Revolucionar"}
                    />
                  )}
                  <FeatureToolButton
                    icon={IconHole}
                    label="Furo"
                    onClick={() => setFeatureToolMode("hole")}
                    disabled={holeCircles.length === 0 || !hasActiveSolid}
                    title={!hasActiveSolid ? "Extrude ou revolucione um sólido antes de furar" : "Furo — Ctrl+clique em vários círculos pra furar todos de uma vez"}
                  />
                  {!isSheetMetal && (
                    <FeatureToolButton
                      icon={IconSweep}
                      label="Varredura"
                      onClick={() => setFeatureToolMode("sweep")}
                      disabled={!profile}
                      title={!profile ? "Feche um perfil no esboço antes de usar Varredura" : "Varre o perfil ao longo do caminho de outro esboço já salvo"}
                    />
                  )}
                  {!isSheetMetal && (
                    <FeatureToolButton
                      icon={IconHelix}
                      label="Espiral"
                      onClick={() => setFeatureToolMode("helix")}
                      disabled={!profile || !centerLine}
                      title={!centerLine ? "Desenhe uma Linha de Centro no sketch antes de usar Espiral" : "Varre o perfil ao longo de uma hélice (mola/rosca)"}
                    />
                  )}
                  {/* Ferramentas de chapa (ao estilo Inventor: Flange/
                      Planificar/Virar Chapa moram dentro de "Criar", não
                      numa aba própria) — a espessura em si só é digitada
                      DENTRO do confirm-step de "Virar Chapa" (ver
                      creatingSheetMetal), nunca antes de abri-lo. */}
                  {isSheetMetal && (
                    <FeatureToolButton
                      icon={IconFlange}
                      label="Flange"
                      onClick={handleStartFlange}
                      disabled={!hasActiveSolid}
                      title={!hasActiveSolid ? "Crie uma Face antes de criar uma flange" : "Cria uma dobra a partir de uma aresta reta da chapa"}
                    />
                  )}
                  {isSheetMetal && hasFlangeFeature && (
                    <FeatureToolButton
                      icon={IconFlatten}
                      label={flattenView ? "Ver Dobrada" : "Planificar"}
                      onClick={() => setFlattenView((v) => !v)}
                      active={flattenView}
                      title="Alterna entre a peça dobrada (3D) e o padrão planificado (pra corte/DXF)"
                    />
                  )}
                  {!isSheetMetal ? (
                    <FeatureToolButton
                      icon={IconSheetMetal}
                      label="Virar Chapa"
                      onClick={() => setCreatingSheetMetal(true)}
                      title="Vira a peça inteira em chapa metálica — habilita Face, Flange e Planificar"
                    />
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          if (!sheetMetalFeature) return;
                          setNewSheetThickness(sheetMetalFeature.thickness);
                          setEditingFeatureId(sheetMetalFeature.id);
                          setCreatingSheetMetal(true);
                        }}
                        title="Editar espessura da chapa"
                        className="flex w-16 shrink-0 flex-col items-center justify-center gap-1 rounded-lg px-1 py-1.5 text-center text-[11px] font-semibold leading-tight text-primary-500 hover:bg-primary-100"
                      >
                        {sheetMetalFeature?.thickness}mm
                      </button>
                      <button
                        type="button"
                        onClick={handleRevertSheetMetal}
                        title="Volta a peça a ser uma peça comum (a geometria já criada continua existindo)"
                        className="flex w-16 shrink-0 items-center justify-center rounded-lg px-1 py-1.5 text-center text-[10px] text-primary-500 hover:bg-primary-100"
                      >
                        Voltar a Peça
                      </button>
                    </>
                  )}
                </FeaturePanel>
              </div>
            )}

            {featureToolMode === null && (
              <>
                <FeaturePanel label="Modificar">
                  <FeatureToolButton
                    icon={IconSplit}
                    label="Cortar Plano"
                    onClick={() => setFeatureToolMode("split")}
                    disabled={!hasActiveSolid}
                    title={!hasActiveSolid ? "Crie um sólido antes de cortar por plano" : "Cortar por Plano"}
                  />
                  <FeatureToolButton
                    icon={IconFillet}
                    label="Arredondar"
                    onClick={handleStartFillet}
                    disabled={!hasActiveSolid}
                    title={!hasActiveSolid ? "Crie um sólido antes de arredondar arestas" : "Arredonda uma ou mais arestas do sólido"}
                  />
                  <FeatureToolButton
                    icon={IconChamfer}
                    label="Chanfrar"
                    onClick={handleStartChamfer}
                    disabled={!hasActiveSolid}
                    title={!hasActiveSolid ? "Crie um sólido antes de chanfrar arestas" : "Chanfra uma ou mais arestas do sólido"}
                  />
                </FeaturePanel>

                <FeaturePanel label="Padrão">
                  <FeatureToolButton
                    icon={IconPatternRect}
                    label="Retangular"
                    onClick={() => setFeatureToolMode("patternRect")}
                    disabled={patternableFeatures.length === 0}
                    title={
                      patternableFeatures.length === 0
                        ? "Crie um Extrudar/Face/Revolução/Furo antes de padronizar"
                        : "Repete uma feature existente numa grade (1 ou 2 direções, eixos X/Y/Z do mundo)"
                    }
                  />
                  <FeatureToolButton
                    icon={IconPatternCircular}
                    label="Circular"
                    onClick={() => setFeatureToolMode("patternCircular")}
                    disabled={patternableFeatures.length === 0}
                    title={
                      patternableFeatures.length === 0
                        ? "Crie um Extrudar/Face/Revolução/Furo antes de padronizar"
                        : "Repete uma feature existente em torno de um eixo (X/Y/Z do mundo ou um Eixo criado)"
                    }
                  />
                </FeaturePanel>

                <FeaturePanel label="Trabalho">
                  <FeatureToolButton icon={IconPlane} label="Plano" onClick={handleCreatePlane} title="Criar Plano" />
                  <FeatureToolButton
                    icon={IconAxis}
                    label="Eixo"
                    onClick={handleCreateAxis}
                    title="Criar eixo X/Y/Z padrão, ou pelo centroide de uma face (cilíndrica: ao longo dela; plana: normal a ela)"
                  />
                </FeaturePanel>
              </>
            )}
          </>
        )}
      </div>
      {/* Divisória arrastável da barra de ferramentas — mesma ideia da
          divisória da árvore de histórico, só que na vertical. */}
      <div
        onPointerDown={handleToolbarResizeStart}
        title="Arraste para redimensionar a barra de ferramentas"
        className="h-1.5 shrink-0 cursor-row-resize bg-primary-100 transition hover:bg-primary-300 active:bg-primary-400"
      />

      {fsAccessSupported === false && (
        <p className="bg-amber-100 px-4 py-2 text-sm text-amber-900">
          Seu navegador não suporta gravar direto num arquivo (File System Access) — recurso só de
          navegadores baseados em Chromium (Chrome, Edge, Opera...); o Firefox e o Safari não têm.
          "Salvar" vai sempre pedir o nome e baixar um arquivo novo, mesmo com um projeto já aberto.
          Pra salvar de verdade sem re-perguntar, use Chrome ou Edge.
        </p>
      )}
      {noticeMessage && (
        <p className="bg-primary-100 px-4 py-2 text-sm text-primary-800">{noticeMessage}</p>
      )}
      {errorMessage && (
        <p className="bg-error/10 px-4 py-2 text-sm text-error">{errorMessage}</p>
      )}
      {debouncedDraftFeature && (
        <p className="bg-[#8e24aa]/10 px-4 py-2 text-sm text-[#8e24aa]">
          Pré-visualização ao vivo — nada foi salvo ainda, ajuste os valores e confirme quando terminar.
        </p>
      )}

      {/* Abaixo de md, os 2 painéis não cabem lado a lado — só um fica
          visível por vez, trocado pelas abas abaixo. Em md+ os dois
          continuam lado a lado como sempre. O 3D é o único viewport agora
          (desenha/seleciona/mede direto nele), então só sobrou Histórico
          como aba separada. */}
      <div className="flex shrink-0 border-b border-primary-100 bg-white text-xs md:hidden">
        {(
          [
            { id: "viewer" as const, label: "3D" },
            { id: "history" as const, label: `Histórico${features.length > 0 ? ` (${features.length})` : ""}` },
          ]
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setMobileTab(t.id)}
            className={`flex-1 border-r border-primary-100 px-2 py-2 font-semibold last:border-r-0 ${
              mobileTab === t.id
                ? "bg-primary-800 text-white"
                : "bg-white text-primary-600 hover:bg-primary-50"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
        <div
          className={`min-h-0 flex-1 md:order-1 md:!block ${mobileTab === "history" ? "" : "hidden"}`}
          style={isDesktop ? { width: historyPanelWidth, flex: "0 0 auto" } : undefined}
        >
          <FeatureHistoryPanel
            features={features}
            onRemove={removeFeature}
            onOpenSketch={handleOpenSketch}
            onEditFeature={handleEditFeature}
          />
        </div>
        {/* Divisória arrastável (só md+, só faz sentido com os 2 painéis
            lado a lado) — ao estilo Inventor, redimensiona a árvore de
            histórico sem mexer no código, só arrastando. */}
        <div
          onPointerDown={handleHistoryResizeStart}
          title="Arraste para redimensionar"
          className="hidden w-1.5 shrink-0 cursor-col-resize bg-primary-100 transition hover:bg-primary-300 active:bg-primary-400 md:order-2 md:block"
        />
        <div className={`min-h-0 flex-1 md:order-3 md:!block ${mobileTab === "viewer" ? "" : "hidden"}`}>
          <Viewer3D
            mesh={mesh}
            pickMode={
              pickingPlane ||
              pickingAxisFace ||
              (creatingPlane && !planeBase) ||
              !!edgeToolMode ||
              (flangePicking && !flangeCandidate)
            }
            onPickPlane={handleFacePicked}
            onPickStandardPlane={
              pickingAxisFace || edgeToolMode || flangePicking || creatingSheetMetal ? undefined : handleStandardPlanePicked
            }
            showPlanePicker={!pickingAxisFace && !edgeToolMode && !flangePicking && !creatingSheetMetal}
            linearEdges={flangePicking && !flangeCandidate ? linearEdges : []}
            onPickLinearEdge={handleFlangeLinePicked}
            pickModeHint={
              flangePicking
                ? "Clique diretamente na aresta reta (linha) da chapa para nascer a flange dali"
                : edgeToolMode
                  ? `Clique em uma ou mais arestas do sólido para ${
                      edgeToolMode === "fillet" ? "arredondar" : "chanfrar"
                    } (${selectedEdgePoints.length} escolhida${selectedEdgePoints.length === 1 ? "" : "s"}) — clique de novo pra tirar`
                  : pickingAxisFace
                    ? "Escolha um eixo X/Y/Z na barra, ou clique numa face cilíndrica (parede de um furo) ou plana"
                    : creatingPlane
                      ? "Clique num dos 3 planos ou numa face para usar como referência"
                      : "Clique num dos 3 planos ou numa face do sólido para esboçar nela"
            }
            onExportFaceDxf={handleExportFaceDxf}
            edgeHighlights={
              flangeCandidate
                ? [
                    [
                      (flangeCandidate.start[0] + flangeCandidate.end[0]) / 2,
                      (flangeCandidate.start[1] + flangeCandidate.end[1]) / 2,
                      (flangeCandidate.start[2] + flangeCandidate.end[2]) / 2,
                    ],
                  ]
                : selectedEdgePoints
            }
            sketchOverlay={
              sketching
                ? { plane: activePlane, referenceGeometry, interactive: true }
                : hasFinishedSketch
                  ? { plane: activePlane, referenceGeometry, interactive: false }
                  : null
            }
            focusPlane={activePlane}
            focusToken={planeFocusToken}
            workPlanes={features.filter((f): f is Extract<Feature, { type: "plane" }> => f.type === "plane").map((f) => f.plane)}
            workAxes={features
              .filter((f): f is Extract<Feature, { type: "axis" }> => f.type === "axis")
              .map((f) => ({ origin: f.origin, direction: f.direction }))}
            planeOffsetDrag={
              planeBase ? { basePlane: planeBase, offset: planeOffset, onOffsetChange: setPlaneOffset } : null
            }
          />
        </div>
      </div>
        </>
      )}
    </div>
  );
}

function FeatureHistoryPanel({
  features,
  onRemove,
  onOpenSketch,
  onEditFeature,
}: {
  features: Feature[];
  onRemove: (id: string) => void;
  onOpenSketch: (feature: Extract<Feature, { type: "sketch" }>) => void;
  onEditFeature: (feature: Feature) => void;
}) {
  return (
    <div className="flex h-full flex-col overflow-y-auto bg-primary-50 p-3">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-primary-500">
        Histórico
      </h2>
      {features.length === 0 && (
        <p className="text-xs text-primary-400">Nenhuma operação ainda.</p>
      )}
      <ul className="space-y-1.5">
        {features.map((feature, index) => {
          const badge = FEATURE_BADGE[feature.type];
          return (
            <li
              key={feature.id}
              className="flex items-center gap-2 rounded-lg bg-white px-2 py-1.5 text-xs text-primary-800 shadow-sm"
            >
              <span
                className={`flex h-5 w-6 shrink-0 items-center justify-center rounded text-[10px] font-bold ${badge.className}`}
              >
                {badge.label}
              </span>
              <button
                type="button"
                onClick={() => (feature.type === "sketch" ? onOpenSketch(feature) : onEditFeature(feature))}
                title={feature.type === "sketch" ? "Reabrir esboço para editar" : "Editar parâmetros"}
                className="flex-1 truncate text-left hover:underline"
              >
                {index + 1}. {feature.label}
              </button>
              <button
                type="button"
                onClick={() => onRemove(feature.id)}
                aria-label="Remover operação"
                className="text-primary-400 hover:text-error"
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

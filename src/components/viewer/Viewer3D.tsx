"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { GizmoHelper, GizmoViewcube, Line, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { ShapeMesh } from "replicad";
import { SketchOverlay3D } from "./SketchOverlay3D";
import { PlanePicker3D } from "./PlanePicker3D";
import { PlaneOffsetDragger3D } from "./PlaneOffsetDragger3D";
import { planeBasisQuaternion } from "./planeBasis";
import { planeYDir } from "@/lib/replicad/plane";
import { useSketchStore } from "@/lib/sketch/store";
import type { SketchPlane } from "@/lib/sketch/types";

// Retângulo bem transparente, sem interação — marca os planos de trabalho
// já criados (features tipo "plane") pra ficarem visíveis no 3D o tempo
// todo, ao estilo Inventor (um plano criado continua visível até ser
// escondido).
function WorkPlaneMarker({ plane }: { plane: SketchPlane }) {
  const quaternion = planeBasisQuaternion(plane);
  return (
    <mesh position={plane.origin} quaternion={[quaternion.x, quaternion.y, quaternion.z, quaternion.w]}>
      <planeGeometry args={[160, 160]} />
      <meshBasicMaterial color="#f59e0b" transparent opacity={0.08} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  );
}

const AXIS_HALF_LENGTH = 150; // mm pra cada lado da origem

// Linha tracejada passando pela origem do eixo, nos dois sentidos — marca
// eixos de trabalho já criados (features tipo "axis"), sem interação.
function WorkAxisMarker({
  origin,
  direction,
}: {
  origin: [number, number, number];
  direction: [number, number, number];
}) {
  const points: [number, number, number][] = [
    [
      origin[0] - direction[0] * AXIS_HALF_LENGTH,
      origin[1] - direction[1] * AXIS_HALF_LENGTH,
      origin[2] - direction[2] * AXIS_HALF_LENGTH,
    ],
    [
      origin[0] + direction[0] * AXIS_HALF_LENGTH,
      origin[1] + direction[1] * AXIS_HALF_LENGTH,
      origin[2] + direction[2] * AXIS_HALF_LENGTH,
    ],
  ];
  return <Line points={points} color="#0d9488" lineWidth={1.5} dashed dashSize={6} gapSize={3} />;
}

// Distância da câmera até a origem do plano ao focar nele — mesma ordem de
// grandeza das distâncias dos presets de vista abaixo.
const PLANE_FOCUS_DISTANCE = 260;

export type SketchOverlayData = {
  plane: SketchPlane;
  // Arestas do sólido projetadas no plano — mesma referência de snap que o
  // editor 2D usa (Project Geometry), pra desenhar/selecionar em 3D
  // reconhecer os mesmos pontos. Shapes/points/dimensions em si vêm direto
  // da store global (mesma fonte que o editor 2D usa).
  referenceGeometry: { x1: number; y1: number; x2: number; y2: number }[];
  // false = mostra o esboço só como referência (ao estilo Inventor: um
  // esboço concluído mas ainda não consumido por uma feature continua
  // visível, mas só editável reabrindo). true = desenha/seleciona direto.
  interactive: boolean;
};

// Enquanto esboçando, o botão esquerdo é reservado pra desenhar/selecionar
// no plano (fase 2 da fusão 2D/3D) — orbitar vira botão direito, e o meio
// continua pan, pra ficar consistente com o middle-drag do editor 2D. Fora
// do modo esboço, os botões voltam ao padrão do OrbitControls.
const SKETCH_MOUSE_BUTTONS = { MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };

type ViewPreset = "isometrica" | "frontal" | "superior";

const VIEW_PRESETS: Record<ViewPreset, [number, number, number]> = {
  isometrica: [180, -180, 180],
  frontal: [0, -260, 0],
  superior: [0, 0, 260],
};

function SolidMesh({
  mesh,
  wireframe,
  pickMode,
  onPick,
  onContextMenu,
}: {
  mesh: ShapeMesh;
  wireframe: boolean;
  pickMode: boolean;
  onPick?: (origin: [number, number, number], normal: [number, number, number]) => void;
  // Botão direito numa face (fora de modo de escolha) — usado pro menu de
  // contexto "Exportar face em DXF", ao estilo Inventor.
  onContextMenu?: (
    origin: [number, number, number],
    normal: [number, number, number],
    clientX: number,
    clientY: number
  ) => void;
}) {
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(mesh.vertices, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(mesh.normals, 3));
    geo.setIndex(mesh.triangles);
    return geo;
  }, [mesh]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  // Destaque da face sob o cursor durante o modo de escolha — só pra deixar
  // claro qual face vai ser escolhida ANTES de clicar (útil agora que o
  // marcador dos planos padrão não cobre mais a peça, ver PlanePicker3D).
  // Malha separada, não cor por vértice: cor por vértice vaza pras faces
  // vizinhas que compartilham vértice na aresta (bleed), já que réplicas de
  // faces adjacentes reaproveitam os mesmos vértices — uma malha à parte,
  // só com os triângulos da face sob o cursor (mesh.faceGroups), fica com
  // contorno nítido e não exige recolorir o material principal.
  const [hoveredFaceId, setHoveredFaceId] = useState<number | null>(null);

  const highlightGeometry = useMemo(() => {
    if (hoveredFaceId == null) return null;
    const group = mesh.faceGroups.find((g) => g.faceId === hoveredFaceId);
    if (!group) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(mesh.vertices, 3));
    geo.setIndex(mesh.triangles.slice(group.start, group.start + group.count));
    return geo;
  }, [mesh, hoveredFaceId]);

  useEffect(() => () => highlightGeometry?.dispose(), [highlightGeometry]);

  function worldNormalOf(event: ThreeEvent<MouseEvent>) {
    return event.face!.normal.clone().transformDirection(event.object.matrixWorld).normalize();
  }

  // faceIndex do three.js é em unidade de TRIÂNGULO (0, 1, 2, ...); start/
  // count de faceGroups são em unidade de ÍNDICE FLAT (mesh.triangles), 3
  // por triângulo — por isso o *3 pra comparar no mesmo referencial.
  function faceIdAt(event: ThreeEvent<PointerEvent>): number | null {
    if (event.faceIndex == null) return null;
    const flatIndex = event.faceIndex * 3;
    const group = mesh.faceGroups.find((g) => flatIndex >= g.start && flatIndex < g.start + g.count);
    return group?.faceId ?? null;
  }

  function handlePointerMove(event: ThreeEvent<PointerEvent>) {
    if (!pickMode) return;
    const id = faceIdAt(event);
    setHoveredFaceId((current) => (current === id ? current : id));
  }

  function handlePointerOut() {
    setHoveredFaceId(null);
  }

  function handleClick(event: ThreeEvent<MouseEvent>) {
    if (!pickMode || !onPick || !event.face) return;
    event.stopPropagation();
    const worldNormal = worldNormalOf(event);
    onPick(
      [event.point.x, event.point.y, event.point.z],
      [worldNormal.x, worldNormal.y, worldNormal.z]
    );
  }

  function handleContextMenu(event: ThreeEvent<MouseEvent>) {
    if (!onContextMenu || !event.face) return;
    event.stopPropagation();
    event.nativeEvent.preventDefault();
    const worldNormal = worldNormalOf(event);
    onContextMenu(
      [event.point.x, event.point.y, event.point.z],
      [worldNormal.x, worldNormal.y, worldNormal.z],
      event.nativeEvent.clientX,
      event.nativeEvent.clientY
    );
  }

  return (
    <>
      <mesh
        geometry={geometry}
        castShadow
        receiveShadow
        onClick={pickMode ? handleClick : undefined}
        onContextMenu={!pickMode && onContextMenu ? handleContextMenu : undefined}
        onPointerMove={pickMode ? handlePointerMove : undefined}
        onPointerOut={pickMode ? handlePointerOut : undefined}
      >
        <meshStandardMaterial
          color={pickMode ? "#78909C" : "#546E7A"}
          wireframe={wireframe}
          side={THREE.DoubleSide}
          metalness={0.05}
          roughness={0.65}
        />
      </mesh>
      {pickMode && highlightGeometry && (
        <mesh geometry={highlightGeometry}>
          <meshBasicMaterial
            color="#4fc3f7"
            side={THREE.DoubleSide}
            transparent
            opacity={0.55}
            depthTest={false}
            polygonOffset
            polygonOffsetFactor={-1}
            polygonOffsetUnits={-1}
          />
        </mesh>
      )}
    </>
  );
}

// Limiar de raycast (mm) contra as linhas de aresta — bem menor que a
// tolerância antiga de clique-na-face (5mm), possível justamente porque
// agora mira na própria geometria da aresta, não numa busca "mais próxima
// do ponto clicado na face" (a fonte da ambiguidade que causava dobras
// nascendo na aresta errada perto de cantos).
const LINEAR_EDGE_PICK_THRESHOLD = 2.5;

// Camada de linhas RETAS do sólido, clicável, pra ferramentas que precisam
// que o usuário escolha uma aresta como se fosse uma linha (ao estilo
// Inventor) — hoje só a Flange. Cada segmento da geometria corresponde 1:1
// a uma entrada de `edges` (2 vértices por segmento, em ordem), então o
// índice do vértice que o raycast acerta (sempre o par par/ímpar de um
// segmento) já identifica exatamente qual aresta foi clicada — sem precisar
// de nenhuma busca "aresta mais próxima" depois.
function LinearEdgePicker3D({
  edges,
  onPick,
}: {
  edges: { start: [number, number, number]; end: [number, number, number] }[];
  onPick: (start: [number, number, number], end: [number, number, number]) => void;
}) {
  const raycaster = useThree((state) => state.raycaster);

  useEffect(() => {
    const previous = raycaster.params.Line?.threshold;
    raycaster.params.Line = { threshold: LINEAR_EDGE_PICK_THRESHOLD };
    return () => {
      raycaster.params.Line = { threshold: previous ?? 1 };
    };
  }, [raycaster]);

  const geometry = useMemo(() => {
    const positions = new Float32Array(edges.length * 6);
    edges.forEach((edge, i) => {
      positions[i * 6] = edge.start[0];
      positions[i * 6 + 1] = edge.start[1];
      positions[i * 6 + 2] = edge.start[2];
      positions[i * 6 + 3] = edge.end[0];
      positions[i * 6 + 4] = edge.end[1];
      positions[i * 6 + 5] = edge.end[2];
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return geo;
  }, [edges]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  function handleClick(event: ThreeEvent<MouseEvent>) {
    if (event.index == null) return;
    event.stopPropagation();
    const edge = edges[Math.floor(event.index / 2)];
    if (edge) onPick(edge.start, edge.end);
  }

  return (
    <lineSegments geometry={geometry} onClick={handleClick} renderOrder={1}>
      <lineBasicMaterial color="#26c6da" transparent opacity={0.9} depthTest={false} />
    </lineSegments>
  );
}

function CameraRig({ position }: { position: [number, number, number] }) {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as { update?: () => void } | null;

  useEffect(() => {
    camera.position.set(position[0], position[1], position[2]);
    camera.up.set(0, 0, 1);
    camera.lookAt(0, 0, 0);
    controls?.update?.();
  }, [position, camera, controls]);

  return null;
}

// GizmoHelper renderiza seus filhos (o ViewCube) dentro de um Hud — uma
// passada de render à parte, com sua PRÓPRIA câmera ortográfica virtual.
// useThree() ali dentro devolve essa câmera pequena do gizmo, nunca a
// câmera de verdade da cena principal — por isso não dá pra simplesmente
// chamar useThree() dentro do cubo pra implementar o arrastar-orbitar.
// Este componente vive FORA do Hud (direto no Canvas principal) só pra
// capturar a câmera/controles/tamanho de verdade numa ref simples, que o
// cubo (dentro do Hud) lê livremente — refs atravessam a fronteira do
// portal sem problema, ao contrário de useThree().
type CameraApi = {
  camera: THREE.Camera;
  controls: { enabled?: boolean; update?: () => void } | null;
  size: { width: number; height: number };
};

function CameraApiCapture({ apiRef }: { apiRef: React.MutableRefObject<CameraApi | null> }) {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as CameraApi["controls"];
  const size = useThree((state) => state.size);

  useEffect(() => {
    apiRef.current = { camera, controls, size };
  }, [apiRef, camera, controls, size]);

  return null;
}

// Gira a câmera em torno de target por deltaAzimuth/deltaPolar (radianos),
// igual o arrastar do OrbitControls — mas reimplementado à mão porque o
// ViewCube fica no Hud (câmera separada) e por isso não pode simplesmente
// deixar o OrbitControls "de verdade" processar o arrasto. setFromUnitVectors
// alinha camera.up com +Y antes da conta esférica e desalinha depois — é o
// mesmo truque que o OrbitControls usa por baixo dos panos pra funcionar
// com qualquer "up" (aqui é Z, não o Y padrão do three.js); sem isso a
// órbita ficaria girando em torno do eixo errado.
function orbitCameraAround(camera: THREE.Camera, target: THREE.Vector3, deltaAzimuth: number, deltaPolar: number) {
  const quat = new THREE.Quaternion().setFromUnitVectors(camera.up, new THREE.Vector3(0, 1, 0));
  const quatInverse = quat.clone().invert();

  const offset = camera.position.clone().sub(target).applyQuaternion(quat);
  const spherical = new THREE.Spherical().setFromVector3(offset);

  spherical.theta -= deltaAzimuth;
  spherical.phi = Math.max(0.001, Math.min(Math.PI - 0.001, spherical.phi - deltaPolar));

  offset.setFromSpherical(spherical).applyQuaternion(quatInverse);
  camera.position.copy(target).add(offset);
  camera.lookAt(target);
}

// Sensibilidade do arrastar no ViewCube — radianos de órbita por "altura de
// tela" arrastada, mesma ordem de grandeza do rotateSpeed padrão do
// OrbitControls (2π por altura da tela).
const CUBE_DRAG_SENSITIVITY = Math.PI;

// Cobre o ViewCube inteiro (não tem geometria própria — um <group> sem
// malha não é alvo de raycast, mas ainda recebe eventos que borbulham dos
// filhos, e nem FaceCube nem EdgeCube do drei chamam stopPropagation() no
// pointerDown, só no click) — ao pressionar e arrastar (em vez de só
// clicar), desliga o OrbitControls principal (senão os dois competem pelo
// mesmo gesto nativo do navegador) e orbita a câmera à mão; soltar
// reativa o OrbitControls. Clicar sem arrastar continua funcionando normal
// (o click do GizmoViewcube dispara por baixo, intacto).
function ViewCubeOrbitCatcher({
  apiRef,
  orbitTarget,
  children,
}: {
  apiRef: React.MutableRefObject<CameraApi | null>;
  orbitTarget: [number, number, number];
  children: React.ReactNode;
}) {
  function handlePointerDown(event: ThreeEvent<PointerEvent>) {
    if (event.nativeEvent.button !== 0) return;
    event.stopPropagation();
    const api = apiRef.current;
    if (!api) return;

    if (api.controls) api.controls.enabled = false;
    let lastX = event.nativeEvent.clientX;
    let lastY = event.nativeEvent.clientY;

    function handleMove(moveEvent: PointerEvent) {
      const dx = moveEvent.clientX - lastX;
      const dy = moveEvent.clientY - lastY;
      lastX = moveEvent.clientX;
      lastY = moveEvent.clientY;
      const h = api!.size.height || 1;
      orbitCameraAround(
        api!.camera,
        new THREE.Vector3(...orbitTarget),
        (dx / h) * CUBE_DRAG_SENSITIVITY,
        (dy / h) * CUBE_DRAG_SENSITIVITY
      );
      api!.controls?.update?.();
    }

    function handleUp() {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      if (api!.controls) api!.controls.enabled = true;
    }

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }

  return <group onPointerDown={handlePointerDown}>{children}</group>;
}

// Ao estilo Inventor/SolidWorks: ao escolher/reabrir um plano de esboço, a
// câmera gira pra encarar esse plano de frente (perpendicular à normal,
// "up" alinhado ao eixo Y local do plano) — em vez de deixar o usuário
// tendo que orbitar manualmente até achar o ângulo certo. "token" (não a
// referência de "plane") é o gatilho de propósito: garante que reescolher
// o MESMO plano padrão (ex.: XY de novo) ainda reoriente a câmera, mesmo
// que o objeto plane seja idêntico ao de antes.
function PlaneFocusCameraRig({
  plane,
  token,
  onTargetChange,
}: {
  plane: SketchPlane | null;
  token: number;
  onTargetChange: (target: [number, number, number]) => void;
}) {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as { update?: () => void } | null;

  useEffect(() => {
    if (!plane || token === 0) return;

    const yDir = planeYDir(plane);
    const position: [number, number, number] = [
      plane.origin[0] + plane.normal[0] * PLANE_FOCUS_DISTANCE,
      plane.origin[1] + plane.normal[1] * PLANE_FOCUS_DISTANCE,
      plane.origin[2] + plane.normal[2] * PLANE_FOCUS_DISTANCE,
    ];

    camera.up.set(yDir[0], yDir[1], yDir[2]);
    camera.position.set(position[0], position[1], position[2]);
    camera.lookAt(plane.origin[0], plane.origin[1], plane.origin[2]);
    onTargetChange(plane.origin);
    controls?.update?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return null;
}

// Folga em volta do sólido ao enquadrar (Home) — margem de 15% pra não
// deixar a peça encostada na borda da tela.
const HOME_FIT_MARGIN = 1.15;
// Raio/distância padrão quando ainda não há sólido nenhum — mesma ordem de
// grandeza dos presets de vista (VIEW_PRESETS).
const HOME_FALLBACK_RADIUS = 120;

// Tecla Home ao estilo Inventor: reenquadra a câmera na peça inteira,
// mantendo o ângulo de visão atual (só ajusta distância e o alvo do
// OrbitControls) — "remove o distanciamento" sem forçar a vista de volta
// pra isométrica, que é o comportamento realmente pedido.
function HomeKeyHandler({
  mesh,
  orbitTarget,
  onTargetChange,
}: {
  mesh: ShapeMesh | null;
  orbitTarget: [number, number, number];
  onTargetChange: (target: [number, number, number]) => void;
}) {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as { update?: () => void } | null;

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Home") return;

      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();

      let center = new THREE.Vector3(0, 0, 0);
      let radius = HOME_FALLBACK_RADIUS;

      if (mesh && mesh.vertices.length >= 3) {
        const box = new THREE.Box3();
        const vertices = mesh.vertices;
        for (let i = 0; i + 2 < vertices.length; i += 3) {
          box.expandByPoint(new THREE.Vector3(vertices[i], vertices[i + 1], vertices[i + 2]));
        }
        box.getCenter(center);
        radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1);
      }

      const fov = "fov" in camera ? (camera as THREE.PerspectiveCamera).fov : 45;
      const fovRad = (fov * Math.PI) / 180;
      const distance = (radius / Math.sin(fovRad / 2)) * HOME_FIT_MARGIN;

      const previousTarget = new THREE.Vector3(orbitTarget[0], orbitTarget[1], orbitTarget[2]);
      const rawDir = camera.position.clone().sub(previousTarget);
      const dir = rawDir.lengthSq() > 1e-6 ? rawDir.normalize() : new THREE.Vector3(1, -1, 1).normalize();

      const newPosition = center.clone().addScaledVector(dir, distance);
      camera.position.copy(newPosition);
      camera.lookAt(center);
      onTargetChange([center.x, center.y, center.z]);
      controls?.update?.();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mesh, orbitTarget, onTargetChange, camera, controls]);

  return null;
}

export function Viewer3D({
  mesh,
  pickMode = false,
  onPickPlane,
  onPickStandardPlane,
  pickModeHint = "Clique num dos 3 planos ou numa face do sólido para esboçar nela",
  showPlanePicker = true,
  sketchOverlay = null,
  focusPlane = null,
  focusToken = 0,
  workPlanes = [],
  workAxes = [],
  planeOffsetDrag = null,
  onExportFaceDxf,
  edgeHighlights = [],
  linearEdges = [],
  onPickLinearEdge,
}: {
  mesh: ShapeMesh | null;
  pickMode?: boolean;
  onPickPlane?: (origin: [number, number, number], normal: [number, number, number]) => void;
  // Clique num dos 3 planos padrão (XY/XZ/YZ) mostrados durante a escolha
  // de plano — alternativa a clicar numa face do sólido existente.
  onPickStandardPlane?: (plane: SketchPlane) => void;
  // pickMode é reaproveitado tanto pra escolher plano de esboço quanto pra
  // escolher uma face pra exportar em DXF — o texto de dica e se os 3
  // planos padrão aparecem mudam conforme o motivo.
  pickModeHint?: string;
  showPlanePicker?: boolean;
  // Esboço ao vivo projetado no plano real, dentro do próprio viewport 3D
  // (fase 2 da fusão 2D/3D — desenhar/selecionar funciona aqui também).
  // null enquanto não está em modo esboço.
  sketchOverlay?: SketchOverlayData | null;
  // Plano pra câmera encarar de frente (ao escolher/reabrir um esboço).
  // focusToken precisa incrementar a cada seleção pra reorientar mesmo se
  // o plano em si não mudou (ex.: escolher "Plano XY" duas vezes seguidas).
  focusPlane?: SketchPlane | null;
  focusToken?: number;
  // Planos de trabalho já criados (features tipo "plane") — só decoração
  // visual persistente, sem interação.
  workPlanes?: SketchPlane[];
  // Eixos de trabalho já criados (features tipo "axis") — mesma ideia, só
  // decoração visual persistente.
  workAxes?: { origin: [number, number, number]; direction: [number, number, number] }[];
  // Quando presente, mostra o plano arrastável de criação de um novo plano
  // de trabalho (ver PlaneOffsetDragger3D) — offset em mm ao longo da
  // normal da referência escolhida.
  planeOffsetDrag?: { basePlane: SketchPlane; offset: number; onOffsetChange: (offset: number) => void } | null;
  // Presente = habilita o menu de contexto (botão direito numa face) com a
  // opção "Exportar face em DXF", ao estilo Inventor.
  onExportFaceDxf?: (origin: [number, number, number], normal: [number, number, number]) => void;
  // Marca visualmente as arestas já escolhidas nas ferramentas 3D de
  // Arredondar/Chanfrar, enquanto o usuário ainda está selecionando mais.
  edgeHighlights?: [number, number, number][];
  // Quando não-vazio (junto com onPickLinearEdge), troca o picking de FACE
  // por uma camada de linhas clicável diretamente contra a geometria das
  // arestas retas do sólido (ao estilo Inventor) — hoje só usado pela
  // Flange, que precisa da aresta exata (não da face onde o clique caiu).
  linearEdges?: { start: [number, number, number]; end: [number, number, number] }[];
  onPickLinearEdge?: (start: [number, number, number], end: [number, number, number]) => void;
}) {
  const [wireframe, setWireframe] = useState(false);
  const [view, setView] = useState<ViewPreset>("isometrica");
  const [orbitTarget, setOrbitTarget] = useState<[number, number, number]>([0, 0, 0]);
  const cameraApiRef = useRef<CameraApi | null>(null);
  const pendingConstraint = useSketchStore((s) => s.pendingConstraint);
  const tool = useSketchStore((s) => s.tool);
  const shapes = useSketchStore((s) => s.shapes);
  const dimensions = useSketchStore((s) => s.dimensions);
  const selectedShapeId = useSketchStore((s) => s.selectedShapeId);
  const deleteSelectedShape = useSketchStore((s) => s.deleteSelectedShape);
  const clearSketch = useSketchStore((s) => s.clear);
  const convertRectToLines = useSketchStore((s) => s.convertRectToLines);
  const clipboard = useSketchStore((s) => s.clipboard);
  const copySelectedShape = useSketchStore((s) => s.copySelectedShape);
  const pasteShape = useSketchStore((s) => s.pasteShape);
  const hasValidSelection = shapes.some((s) => s.id === selectedShapeId);
  const selectedIsRect = shapes.some((s) => s.id === selectedShapeId && s.type === "rect");
  const [faceMenu, setFaceMenu] = useState<{
    x: number;
    y: number;
    origin: [number, number, number];
    normal: [number, number, number];
  } | null>(null);
  const linearEdgeMode = linearEdges.length > 0 && !!onPickLinearEdge;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-primary-100 bg-primary-50 px-3 py-2 text-sm">
        {(Object.keys(VIEW_PRESETS) as ViewPreset[]).map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => {
              setView(preset);
              setOrbitTarget([0, 0, 0]);
            }}
            className={`rounded-lg px-3 py-1.5 capitalize transition ${
              view === preset
                ? "bg-primary text-primary-foreground"
                : "bg-white text-primary-700 hover:bg-primary-100"
            }`}
          >
            {preset}
          </button>
        ))}
        {sketchOverlay?.interactive && (
          <div className="ml-auto flex items-center gap-2">
            {selectedIsRect && (
              <button
                type="button"
                onClick={() => selectedShapeId && convertRectToLines(selectedShapeId)}
                title="Transforma o retângulo em 4 linhas independentes, editáveis uma a uma"
                className="rounded-lg bg-white px-3 py-1.5 text-primary-700 hover:bg-primary-100"
              >
                Converter em Linhas
              </button>
            )}
            <button
              type="button"
              onClick={copySelectedShape}
              disabled={!hasValidSelection}
              title="Copiar geometria selecionada (Ctrl+C)"
              className="rounded-lg bg-white px-3 py-1.5 text-primary-700 hover:bg-primary-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Copiar
            </button>
            <button
              type="button"
              onClick={pasteShape}
              disabled={!clipboard}
              title="Colar (Ctrl+V)"
              className="rounded-lg bg-white px-3 py-1.5 text-primary-700 hover:bg-primary-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Colar
            </button>
            <button
              type="button"
              onClick={deleteSelectedShape}
              disabled={!hasValidSelection}
              title="Excluir geometria selecionada (Delete)"
              className="rounded-lg bg-white px-3 py-1.5 text-primary-700 hover:bg-primary-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Excluir
            </button>
            <button
              type="button"
              onClick={clearSketch}
              disabled={shapes.length === 0 && dimensions.length === 0}
              className="rounded-lg bg-white px-3 py-1.5 text-primary-700 hover:bg-primary-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Limpar
            </button>
          </div>
        )}
        <label className={`flex items-center gap-2 text-primary-700 ${sketchOverlay?.interactive ? "" : "ml-auto"}`}>
          <input
            type="checkbox"
            checked={wireframe}
            onChange={(e) => setWireframe(e.target.checked)}
          />
          Wireframe
        </label>
      </div>

      <div className={`relative flex-1 ${pickMode ? "cursor-crosshair" : ""}`}>
        <Canvas
          camera={{ position: VIEW_PRESETS.isometrica, fov: 45, up: [0, 0, 1], near: 0.1, far: 10000 }}
          shadows="basic"
        >
          <color attach="background" args={["#ffffff"]} />
          <ambientLight intensity={0.7} />
          <directionalLight position={[120, -150, 220]} intensity={1} castShadow />
          <CameraRig position={VIEW_PRESETS[view]} />
          <PlaneFocusCameraRig plane={focusPlane} token={focusToken} onTargetChange={setOrbitTarget} />
          <HomeKeyHandler mesh={mesh} orbitTarget={orbitTarget} onTargetChange={setOrbitTarget} />
          {mesh && (
            <SolidMesh
              mesh={mesh}
              wireframe={wireframe}
              pickMode={pickMode && !linearEdgeMode}
              onPick={linearEdgeMode ? undefined : onPickPlane}
              onContextMenu={
                onExportFaceDxf
                  ? (origin, normal, clientX, clientY) => setFaceMenu({ x: clientX, y: clientY, origin, normal })
                  : undefined
              }
            />
          )}
          {linearEdgeMode && (
            <LinearEdgePicker3D edges={linearEdges} onPick={onPickLinearEdge!} />
          )}
          {sketchOverlay && (
            <SketchOverlay3D
              plane={sketchOverlay.plane}
              referenceGeometry={sketchOverlay.referenceGeometry}
              interactive={sketchOverlay.interactive}
            />
          )}
          {pickMode && showPlanePicker && onPickStandardPlane && (
            <PlanePicker3D onPick={onPickStandardPlane} />
          )}
          {workPlanes.map((plane, i) => (
            <WorkPlaneMarker key={i} plane={plane} />
          ))}
          {workAxes.map((axis, i) => (
            <WorkAxisMarker key={i} origin={axis.origin} direction={axis.direction} />
          ))}
          {edgeHighlights.map((p, i) => (
            <mesh key={i} position={p}>
              <sphereGeometry args={[2, 12, 12]} />
              <meshBasicMaterial color="#f59e0b" />
            </mesh>
          ))}
          {planeOffsetDrag && (
            <PlaneOffsetDragger3D
              basePlane={planeOffsetDrag.basePlane}
              offset={planeOffsetDrag.offset}
              onOffsetChange={planeOffsetDrag.onOffsetChange}
            />
          )}
          {mesh && <gridHelper args={[400, 40]} rotation={[Math.PI / 2, 0, 0]} />}
          <axesHelper args={[60]} />
          <CameraApiCapture apiRef={cameraApiRef} />
          {/* ViewCube ao estilo Inventor/SolidWorks: clique numa face, aresta
              ou canto do cubo pra ir direto pra aquela vista (a câmera anima
              suavemente) — mesma ideia dos botões isométrica/frontal/
              superior, só que com todas as 26 vistas (6 faces + 12 arestas +
              8 cantos) num widget só, no canto do viewport. Ordem do array
              `faces` é a mesma do agrupamento de material do BoxGeometry do
              three.js (+X,-X,+Y,-Y,+Z,-Z); como o mundo aqui é Z-up (não
              Y-up, o padrão do three.js), essa ordem NÃO é
              Direita/Esquerda/Cima/Baixo/Frente/Trás — foi remapeada
              conferindo contra os presets de vista já existentes (frontal
              fica em -Y, superior em +Z). */}
          <GizmoHelper
            alignment="top-right"
            margin={[70, 70]}
            onTarget={() => new THREE.Vector3(...orbitTarget)}
          >
            <ViewCubeOrbitCatcher apiRef={cameraApiRef} orbitTarget={orbitTarget}>
              <GizmoViewcube
                faces={["DIREITA", "ESQUERDA", "TRÁS", "FRENTE", "CIMA", "BAIXO"]}
                color="#eceff1"
                hoverColor="#546E7A"
                textColor="#263238"
                strokeColor="#90a4ae"
              />
            </ViewCubeOrbitCatcher>
          </GizmoHelper>
          <OrbitControls
            makeDefault
            target={orbitTarget}
            mouseButtons={sketchOverlay?.interactive || planeOffsetDrag ? SKETCH_MOUSE_BUTTONS : undefined}
            enableZoom
            zoomToCursor
            zoomSpeed={1.2}
            minDistance={5}
            maxDistance={4000}
          />
        </Canvas>

        {!mesh && !pickMode && !sketchOverlay && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-primary-500">
            Desenhe um perfil e clique em “Extrudar” para ver o sólido aqui.
          </div>
        )}
        {pickMode && (
          <div className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 rounded-full bg-primary-900/95 px-4 py-2 text-sm font-semibold text-white shadow-lg">
            {pickModeHint}
          </div>
        )}
        {sketchOverlay?.interactive && (
          <div className="pointer-events-none absolute right-2 top-2 rounded-full bg-primary-900/95 px-4 py-2 text-sm font-semibold text-white shadow-lg">
            {pendingConstraint
              ? pendingConstraint.kind === "perpendicular"
                ? "Selecione a 2ª linha (perpendicular à 1ª)"
                : pendingConstraint.kind === "tangent"
                  ? `Selecione ${pendingConstraint.firstShapeKind === "circle" ? "a linha" : "o círculo"} tangente`
                  : "Selecione o 2º ponto (será unido ao 1º)"
              : `${tool.charAt(0).toUpperCase() + tool.slice(1)} · esquerdo desenha/seleciona · direito orbita · meio arrasta a vista`}
          </div>
        )}
        {sketchOverlay && !sketchOverlay.interactive && (
          <div className="pointer-events-none absolute right-2 top-2 rounded-full bg-primary-900/95 px-4 py-2 text-sm font-semibold text-white shadow-lg">
            Esboço ainda não usado numa operação · clique em "Editar Esboço" pra continuar
          </div>
        )}
        {faceMenu && (
          <>
            {/* Fecha o menu clicando em qualquer lugar (ou botão direito de
                novo) fora dele — padrão comum de menu de contexto. */}
            <div
              className="fixed inset-0 z-40"
              onClick={() => setFaceMenu(null)}
              onContextMenu={(e) => {
                e.preventDefault();
                setFaceMenu(null);
              }}
            />
            <div
              className="fixed z-50 min-w-[180px] rounded-lg border border-primary-100 bg-white py-1 text-sm shadow-lg"
              style={{ left: faceMenu.x, top: faceMenu.y }}
            >
              <button
                type="button"
                onClick={() => {
                  onExportFaceDxf?.(faceMenu.origin, faceMenu.normal);
                  setFaceMenu(null);
                }}
                className="block w-full whitespace-nowrap px-3 py-1.5 text-left text-primary-700 hover:bg-primary-100"
              >
                Exportar face em DXF
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

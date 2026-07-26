"use client";

import { useMemo, useRef, useState } from "react";
import { Line, Html } from "@react-three/drei";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { localToWorldPoint, worldToLocalPoint } from "@/lib/replicad/plane";
import { planeBasisQuaternion } from "./planeBasis";
import { useSketchStore } from "@/lib/sketch/store";
import {
  resolveDimension,
  resolveShape,
  draftPreviewFor,
  sampleMinorArc,
  perpendicularDistanceToLine,
  slotOutline,
  computeDimensionLineGeometry,
  computeRadiusDimensionGeometry,
  DEFAULT_DIM_OFFSET,
  type RenderableShape,
} from "@/lib/sketch/render";
import type { SketchPlane, SketchPoint } from "@/lib/sketch/types";

// Fase 2 da fusão 2D/3D: além de mostrar o esboço ao vivo projetado no
// plano, um plano invisível (mas raycastável) capta clique/arrasto e
// alimenta a MESMA máquina de interação da store que o editor 2D usa —
// desenhar/selecionar/arrastar num painel aparece instantaneamente no
// outro, porque os dois leem/escrevem o mesmo estado. Cores fixas (não
// var(--...)) porque materiais do Three.js não resolvem custom properties
// de CSS.
const GEOMETRY_COLOR = "#0d1b2a";
// Linha vinda da ferramenta Projetar Geometria — cor distinta (mesmo azul
// da geometria de referência que ela costumava ser antes de virar linha de
// verdade), pra continuar óbvio de onde ela nasceu.
const PROJECTED_COLOR = "#1e88e5";
const CENTERLINE_COLOR = "#607d8b";
const DIMENSION_COLOR = "#455a64";
const MEASURE_COLOR = "#d97706";
const SELECTED_COLOR = "#e53935";
// Forma marcada via Ctrl+clique pra virar perfil de Extrudar/Face/Revolução
// (multiProfileSelection) — cor própria pra não confundir com a seleção
// simples (vermelha) de Selecionar.
const PROFILE_SELECTED_COLOR = "#8e24aa";
const DRAFT_COLOR = "#607d8b";
const SNAP_COLOR = "#2e7d32";
// Linha guia de alinhamento (ao estilo Inventor) ao posicionar o Rasgo —
// ver alignmentGuides em sketch/store.ts / findAlignmentGuides.
const ALIGN_GUIDE_COLOR = "#e91e63";
const ALIGN_GUIDE_MARGIN = 8; // mm — quanto a linha guia passa além do ponto/referência, pra ficar óbvia
const PLANE_COLOR = "#4fc3f7";
const PLANE_HALF_SIZE = 200; // mm — mesmo tamanho do mundo do esboço 2D
const INTERACTIVE_PLANE_SIZE = 4000; // bem maior que o destaque visual, pra sobrar espaço pra desenhar
const CIRCLE_SEGMENTS = 48;

type Vec3 = [number, number, number];
type LocalPoint = { x: number; y: number };
type ReferenceSegment = { x1: number; y1: number; x2: number; y2: number };

// Converte um evento de ponteiro NATIVO do DOM (clientX/clientY de um
// PointerEvent comum, não um ThreeEvent do R3F) pra coordenadas locais 2D
// do plano do sketch, via raycast manual (câmera + plano matemático — sem
// precisar de nenhuma mesh pra interceptar, ao contrário do InteractivePlane).
// Usado só pelo arrasto que começa no PRÓPRIO rótulo da cota (ver
// DimensionLabel): como o rótulo é HTML de verdade (Html do drei já não
// passa pelo raycasting do canvas), pointerdown nele nunca chega no
// InteractivePlane — então o arrasto iniciado ali precisa da SUA PRÓPRIA
// conversão tela→mundo, replicando manualmente o mesmo raycast que o R3F já
// faz sozinho contra uma mesh de verdade.
const dragRaycaster = new THREE.Raycaster();
const dragNdc = new THREE.Vector2();
const dragHit = new THREE.Vector3();

function screenToLocalPoint(
  clientX: number,
  clientY: number,
  camera: THREE.Camera,
  domElement: HTMLElement,
  plane: SketchPlane
): LocalPoint | null {
  const rect = domElement.getBoundingClientRect();
  dragNdc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  dragRaycaster.setFromCamera(dragNdc, camera);
  const threePlane = new THREE.Plane().setFromNormalAndCoplanarPoint(
    new THREE.Vector3(...plane.normal),
    new THREE.Vector3(...plane.origin)
  );
  const hit = dragRaycaster.ray.intersectPlane(threePlane, dragHit);
  if (!hit) return null;
  return worldToLocalPoint(plane, [hit.x, hit.y, hit.z]);
}

// Distância em PIXELS de tela (não mm de mundo) que o ponteiro precisa
// andar antes de um pointerdown no rótulo virar arrasto em vez de clique
// (abre edição) — ver handlePointerDown em DimensionLabel.
const LABEL_DRAG_THRESHOLD_PX = 4;

function circlePoints(center: LocalPoint, radius: number): LocalPoint[] {
  const pts: LocalPoint[] = [];
  for (let i = 0; i <= CIRCLE_SEGMENTS; i++) {
    const a = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
    pts.push({ x: center.x + Math.cos(a) * radius, y: center.y + Math.sin(a) * radius });
  }
  return pts;
}

// Retângulo semitransparente + cruz de eixos locais na posição real do
// plano — dá a mesma noção de "onde estou esboçando" que o destaque azul
// de plano do Inventor, sem precisar desenhar uma grade completa.
function PlaneHighlight({ plane }: { plane: SketchPlane }) {
  const { quaternion, corners, axisX, axisY } = useMemo(() => {
    const q = planeBasisQuaternion(plane);
    const s = PLANE_HALF_SIZE;
    const corners: Vec3[] = [
      localToWorldPoint(plane, { x: -s, y: -s }),
      localToWorldPoint(plane, { x: s, y: -s }),
      localToWorldPoint(plane, { x: s, y: s }),
      localToWorldPoint(plane, { x: -s, y: s }),
      localToWorldPoint(plane, { x: -s, y: -s }),
    ];

    const axisLen = s * 0.3;
    const axisX: Vec3[] = [plane.origin, localToWorldPoint(plane, { x: axisLen, y: 0 })];
    const axisY: Vec3[] = [plane.origin, localToWorldPoint(plane, { x: 0, y: axisLen })];

    return { quaternion: q, corners, axisX, axisY };
  }, [plane]);

  return (
    <group>
      <mesh position={plane.origin} quaternion={[quaternion.x, quaternion.y, quaternion.z, quaternion.w]}>
        <planeGeometry args={[PLANE_HALF_SIZE * 2, PLANE_HALF_SIZE * 2]} />
        <meshBasicMaterial
          color={PLANE_COLOR}
          transparent
          opacity={0.06}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      <Line points={corners} color={PLANE_COLOR} transparent opacity={0.5} lineWidth={1} />
      <Line points={axisX} color="#e53935" lineWidth={1.5} />
      <Line points={axisY} color="#43a047" lineWidth={1.5} />
    </group>
  );
}

// Ponto de origem do esboço (0,0 do plano ativo) — sempre visível, ao
// estilo do ponto verde de origem do Inventor. Marcador só visual (um
// pouco maior que um ponto solto comum + uma cruz fina) — o ponto em si já
// está no pool (ORIGIN_POINT em types.ts) e participa do snap normal,
// então não precisa de nenhuma interação própria aqui.
const ORIGIN_MARKER_COLOR = "#2e7d32";
const ORIGIN_MARKER_SIZE = 4;

function OriginMarker({ plane }: { plane: SketchPlane }) {
  const toWorld = (local: LocalPoint): Vec3 => localToWorldPoint(plane, local);
  const center = toWorld({ x: 0, y: 0 });
  return (
    <group>
      <Line
        points={[toWorld({ x: -ORIGIN_MARKER_SIZE, y: 0 }), toWorld({ x: ORIGIN_MARKER_SIZE, y: 0 })]}
        color={ORIGIN_MARKER_COLOR}
        lineWidth={1}
      />
      <Line
        points={[toWorld({ x: 0, y: -ORIGIN_MARKER_SIZE }), toWorld({ x: 0, y: ORIGIN_MARKER_SIZE })]}
        color={ORIGIN_MARKER_COLOR}
        lineWidth={1}
      />
      <mesh position={center}>
        <sphereGeometry args={[1.1, 12, 12]} />
        <meshBasicMaterial color={ORIGIN_MARKER_COLOR} />
      </mesh>
    </group>
  );
}

// Eixo do Rasgo/Oblongo (centro a centro) desenhado como linha de
// CONSTRUÇÃO, ao estilo Inventor: tracejada + os 2 pontos de centro
// marcados — não é geometria de perfil (não entra em profileSourceForShape
// nem sai no perfil de Extrudar), só referência visual, sempre visível
// (durante os 3 passos de posicionar E depois de já criado, ver uso em
// renderShapes.map e no preview do 3º passo/raio mais abaixo).
function SlotConstructionAxis({ plane, c1, c2 }: { plane: SketchPlane; c1: LocalPoint; c2: LocalPoint }) {
  const toWorld = (local: LocalPoint): Vec3 => localToWorldPoint(plane, local);
  return (
    <group>
      <Line points={[toWorld(c1), toWorld(c2)]} color={CENTERLINE_COLOR} lineWidth={1} dashed dashSize={4} gapSize={2} />
      <mesh position={toWorld(c1)}>
        <sphereGeometry args={[1.4, 10, 10]} />
        <meshBasicMaterial color={CENTERLINE_COLOR} />
      </mesh>
      <mesh position={toWorld(c2)}>
        <sphereGeometry args={[1.4, 10, 10]} />
        <meshBasicMaterial color={CENTERLINE_COLOR} />
      </mesh>
    </group>
  );
}

// Plano invisível (opacity 0, mas ainda raycastável) maior que o destaque
// visual — capta pointerdown/move/up, converte pra coordenadas locais 2D do
// plano e alimenta a mesma handleRawDown/Move/Up que o editor 2D usa.
function InteractivePlane({ plane, referenceGeometry }: { plane: SketchPlane; referenceGeometry: ReferenceSegment[] }) {
  const gl = useThree((s) => s.gl);
  const handleRawDown = useSketchStore((s) => s.handleRawDown);
  const handleRawMove = useSketchStore((s) => s.handleRawMove);
  const handleRawUp = useSketchStore((s) => s.handleRawUp);
  const clearHover = useSketchStore((s) => s.clearHover);

  const quaternion = useMemo(() => planeBasisQuaternion(plane), [plane]);

  function toRaw(event: ThreeEvent<PointerEvent>): LocalPoint {
    return worldToLocalPoint(plane, [event.point.x, event.point.y, event.point.z]);
  }

  return (
    <mesh
      position={plane.origin}
      quaternion={[quaternion.x, quaternion.y, quaternion.z, quaternion.w]}
      onPointerDown={(e) => {
        if (e.button !== 0) return; // só botão esquerdo desenha/seleciona — direito/meio ficam pra órbita/pan da câmera
        e.stopPropagation();
        gl.domElement.setPointerCapture(e.pointerId);
        handleRawDown(toRaw(e), referenceGeometry, e.ctrlKey || e.metaKey);
      }}
      onPointerMove={(e) => {
        e.stopPropagation();
        handleRawMove(toRaw(e), referenceGeometry);
      }}
      onPointerUp={(e) => {
        e.stopPropagation();
        // Libera explicitamente (não confia só na liberação implícita do
        // browser) — com a ferramenta Cota agora exigindo um 2º clique em
        // seguida (dimensionPick1), e o rótulo da cota recém-criada
        // aparecendo bem em cima de onde o ponteiro está, uma captura que
        // ficasse presa no canvas roubaria o clique seguinte que deveria
        // cair no botão de editar/remover (Html é DOM normal, fora do
        // raycasting do R3F — só recebe o clique se o canvas não estiver
        // segurando o ponteiro).
        if (gl.domElement.hasPointerCapture(e.pointerId)) {
          gl.domElement.releasePointerCapture(e.pointerId);
        }
        handleRawUp(toRaw(e), referenceGeometry);
      }}
      onPointerLeave={() => clearHover()}
    >
      <planeGeometry args={[INTERACTIVE_PLANE_SIZE, INTERACTIVE_PLANE_SIZE]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

// Rótulo de uma cota — igual ao estilo Inventor: clicar no valor abre uma
// caixa de texto NO PRÓPRIO LUGAR da cota (não um prompt() nativo do
// navegador, que quebra o clima de "editor de verdade" flutuando por cima
// de tudo); Enter ou clicar fora confirma, Esc cancela. Clicar no × remove.
// Html do drei já é DOM normal (não passa pelo raycasting do canvas), então
// não precisa do mesmo cuidado de stopPropagation contra o pointerdown do
// plano interativo que o SVG precisava — só o clique nativo mesmo.
function DimensionLabel({
  position,
  plane,
  text,
  numericValue,
  formulaText,
  editing = false,
  onStartEdit,
  onCommitEdit,
  onCancelEdit,
  onRemove,
  isReference = false,
  isFormula = false,
  isPickingSource = false,
  isPickTarget = false,
  onToggleReference,
  onStartFormula,
  onDragStart,
  onDragMove,
  onDragEnd,
}: {
  position: Vec3;
  // Só precisa pra converter tela→mundo no arrasto iniciado pelo próprio
  // rótulo (ver onDragStart/Move/End) — opcional porque o rótulo do
  // medidor ao vivo (ferramenta Medir) não é arrastável, não passa isso.
  plane?: SketchPlane;
  text: string;
  numericValue?: number;
  // Texto CRU a mostrar no <input> ao abrir a edição — a fórmula já salva
  // (dim.formula) OU um rascunho em andamento (ver formulaDraft no
  // componente pai, preenchido depois de clicar numa cota-referência).
  // Ausente = mostra o valor numérico normal.
  formulaText?: string;
  editing?: boolean;
  onStartEdit?: () => void;
  onCommitEdit?: (rawText: string) => void;
  onCancelEdit?: () => void;
  onRemove?: () => void;
  // Cota de referência (ao estilo Inventor "driven dimension") — só relata
  // a medida, o botão do valor não abre o <input> de edição.
  isReference?: boolean;
  // Tem uma fórmula salva (dim.formula) — só afeta o texto exibido (sufixo
  // " ="), a edição continua funcionando normal (digitar um número puro
  // apaga a fórmula, ver updateDimensionValue em store.ts).
  isFormula?: boolean;
  // Essa é a cota de ORIGEM da fórmula em andamento agora (ver
  // pickingFormula no componente pai) — realce visual; clicar nela de novo
  // cancela o modo.
  isPickingSource?: boolean;
  // Alguma OUTRA cota está montando uma fórmula agora, esperando o clique
  // nessa aqui pra inserir o paramName dela — nesse estado, clicar no
  // valor NÃO abre edição, insere a referência (ver onStartEdit repassado
  // pelo pai).
  isPickTarget?: boolean;
  onToggleReference?: () => void;
  // Chamado com o texto ATUAL do <input> (pra não perder o que já foi
  // digitado) ao apertar "=" ou clicar no botão "=" — o pai fecha essa
  // edição e arma o modo de montar fórmula (ver pickingFormula).
  onStartFormula?: (currentText: string) => void;
  // Arrastar o PRÓPRIO rótulo (não só a linha de cota, ver
  // findDimensionHit em store.ts) move a cota igual a folha de desenho 2D —
  // clicar e soltar sem mexer o suficiente ainda abre edição (onStartEdit),
  // só passa a arrastar de verdade acima de LABEL_DRAG_THRESHOLD_PX.
  onDragStart?: () => void;
  onDragMove?: (raw: LocalPoint) => void;
  onDragEnd?: (raw: LocalPoint | null) => void;
}) {
  const { camera, gl } = useThree();
  const inputRef = useRef<HTMLInputElement>(null);
  // distanceFactor controla o tamanho "no mundo": drei escala o HTML por
  // objectScale(câmera) * distanceFactor, onde objectScale ~ 1/distância —
  // ou seja, o rótulo cresce ao aproximar e encolhe ao afastar, do mesmo
  // jeito que a peça na tela (proporcional ao zoom). 220 deixa o texto em
  // tamanho natural (~100%) na distância padrão da câmera ao focar um
  // plano (260mm).
  // Editando: a ÚNICA hora que aparece uma caixinha branca de verdade — o
  // <input> pra digitar o valor OU uma fórmula (ex.: "d9*2", ver
  // formula.ts), com os controles de referência/fórmula/remover do lado
  // (só existem aqui, nunca no repouso, ver comentário abaixo). Confirma
  // com Enter/clicar fora, cancela com Esc.
  if (editing) {
    const initialValue = formulaText ?? (numericValue !== undefined ? String(Number(numericValue.toFixed(3))) : "");
    // O <input> tem onBlur pra confirmar ao clicar fora — mas isso também
    // dispara em 2 situações que NÃO deveriam contar como "confirmar":
    // (1) clicar nos botões =/R/× ao lado (o pointerdown deles tira o foco
    // do input ANTES do próprio onClick rodar, então sem tratar isso o
    // onBlur comitava um valor errado/redundante antes da ação real
    // acontecer); (2) apertar "=" no teclado, que fecha essa edição
    // programaticamente (via onCancelEdit) pra abrir o modo de montar
    // fórmula — a remontagem do <input> em outro estado também gera um
    // blur nativo. suppressBlurRef marca os dois casos pra onBlur ignorar.
    const suppressBlurRef = { current: false };
    return (
      <Html position={position} center distanceFactor={220} pointerEvents="auto">
        <span className="flex items-center gap-1 rounded-lg border border-primary bg-white px-2 py-1 shadow-md">
          <input
            ref={inputRef}
            type="text"
            autoFocus
            defaultValue={initialValue}
            title={onStartFormula && !isReference ? "Digite um valor, ou = e clique noutra cota pra usar o valor dela (ex.: d9*2)" : undefined}
            onFocus={(e) => e.currentTarget.select()}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              // Digitar "=" ao estilo Inventor: entra no modo de montar
              // fórmula (mesma coisa que clicar no botão "=" ao lado),
              // preservando o que já tinha sido digitado — pra dar pra
              // escrever "d9*2" clicando em d9 no meio da digitação. Só
              // faz sentido se essa cota já pode virar origem de fórmula
              // (não é referência).
              if (e.key === "=" && onStartFormula && !isReference) {
                e.preventDefault();
                suppressBlurRef.current = true;
                const current = e.currentTarget.value;
                onCancelEdit?.();
                onStartFormula(current);
                return;
              }
              if (e.key === "Enter") {
                onCommitEdit?.(e.currentTarget.value);
              } else if (e.key === "Escape") {
                onCancelEdit?.();
              }
            }}
            onBlur={(e) => {
              if (suppressBlurRef.current) return;
              onCommitEdit?.(e.currentTarget.value);
            }}
            className="w-20 rounded border-none bg-transparent text-center text-base font-bold text-primary-900 outline-none"
          />
          {onStartFormula && !isReference && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                const current = inputRef.current?.value ?? "";
                onCancelEdit?.();
                onStartFormula(current);
              }}
              // preventDefault aqui é o que importa: sem isso, o próprio
              // pointerdown do botão já tira o foco do input (chamando
              // onBlur, ver acima) ANTES desse onClick rodar.
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              title="Usar o valor de outra cota: clique aqui, depois clique na outra cota (dá pra continuar digitando depois, ex.: d9*2)"
              className="cursor-pointer rounded px-1 text-xs text-primary-400 hover:bg-[#8e24aa]/10 hover:text-[#8e24aa]"
            >
              =
            </button>
          )}
          {onToggleReference && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleReference();
                onCancelEdit?.();
              }}
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              title={isReference ? "Virar cota normal (editável)" : "Virar cota de referência (só relata a medida)"}
              className="cursor-pointer rounded px-1 text-xs text-primary-400 hover:bg-primary-100"
            >
              R
            </button>
          )}
          {onRemove && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              className="cursor-pointer rounded px-1 text-primary-400 hover:bg-error/10 hover:text-error"
            >
              ×
            </button>
          )}
        </span>
      </Html>
    );
  }

  // Repouso: SÓ o texto (sem balão/pílula branca por trás) — igual o
  // Inventor mostra a cota direto sobre o desenho. Um text-shadow branco no
  // lugar do fundo mantém legível em cima de qualquer geometria/cor. Os
  // controles de referência/fórmula/remover só existem no modo "editing"
  // acima — clicar aqui é o único jeito de "abrir" a cota (ver onStartEdit,
  // que também é quem trata o clique de inserir essa cota numa fórmula em
  // andamento de outra).
  const displayText = isReference ? `(${text})` : isFormula ? `${text} =` : text;
  const color = isPickingSource || isPickTarget ? "#8e24aa" : "#1a2733";

  // Clicar e soltar sem mexer o suficiente = editar (onStartEdit, igual
  // sempre foi); mexer além de LABEL_DRAG_THRESHOLD_PX antes de soltar =
  // arrastar a cota pro lugar, igual a folha de desenho 2D. Tudo em pixels
  // de TELA (não mm de mundo) — a conversão pra coordenada local do plano
  // só acontece depois de confirmar que é arrasto de verdade (ver
  // screenToLocalPoint). Pointer capture no próprio botão: dispensa
  // qualquer listener em document/window, o próprio elemento recebe
  // move/up mesmo se o cursor sair de cima dele.
  function handlePointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    e.stopPropagation();
    if (!plane || (!onDragStart && !onDragMove && !onDragEnd)) {
      return;
    }
    const activePlane = plane;
    const startX = e.clientX;
    const startY = e.clientY;
    let armed = false;
    const target = e.currentTarget;
    const pointerId = e.pointerId;
    target.setPointerCapture(pointerId);

    function handleMove(ev: PointerEvent) {
      if (!armed) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < LABEL_DRAG_THRESHOLD_PX) return;
        armed = true;
        onDragStart?.();
      }
      const raw = screenToLocalPoint(ev.clientX, ev.clientY, camera, gl.domElement, activePlane);
      if (raw) onDragMove?.(raw);
    }

    function handleUp(ev: PointerEvent) {
      target.releasePointerCapture(pointerId);
      target.removeEventListener("pointermove", handleMove);
      target.removeEventListener("pointerup", handleUp);
      if (armed) {
        onDragEnd?.(screenToLocalPoint(ev.clientX, ev.clientY, camera, gl.domElement, activePlane));
      } else {
        onStartEdit?.();
      }
    }

    target.addEventListener("pointermove", handleMove);
    target.addEventListener("pointerup", handleUp);
  }

  return (
    <Html position={position} center distanceFactor={220} pointerEvents="auto">
      <button
        type="button"
        onPointerDown={handlePointerDown}
        title={
          isPickTarget
            ? "Clique pra usar o valor dessa cota na fórmula em andamento"
            : isReference
              ? "Cota de referência — só relata a medida da geometria"
              : isFormula
                ? "Tem fórmula — clique pra editar (digitar um número puro apaga a fórmula)"
                : onDragStart
                  ? "Clique pra editar, arraste pra mover"
                  : undefined
        }
        className={`whitespace-nowrap bg-transparent text-base font-bold ${onStartEdit ? "cursor-pointer hover:underline" : "cursor-default"} ${onDragStart ? "cursor-move" : ""}`}
        style={{ color, textShadow: "0 0 4px #fff, 0 0 4px #fff, 0 0 4px #fff, 0 0 4px #fff" }}
      >
        {displayText}
      </button>
    </Html>
  );
}

// Triângulo preenchido (seta de cota) — Line do drei só desenha traço, não
// dá pra preencher, então a seta é uma mesh com 3 vértices crus (os 3 pontos
// já em coordenadas de MUNDO, resolvidos por quem chama via toWorld).
function Arrowhead3D({
  points,
  toWorld,
  color,
}: {
  points: [LocalPoint, LocalPoint, LocalPoint];
  toWorld: (p: LocalPoint) => Vec3;
  color: string;
}) {
  const positions = new Float32Array(9);
  points.forEach((p, i) => {
    const w = toWorld(p);
    positions[i * 3] = w[0];
    positions[i * 3 + 1] = w[1];
    positions[i * 3 + 2] = w[2];
  });
  return (
    <mesh>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <meshBasicMaterial color={color} side={THREE.DoubleSide} />
    </mesh>
  );
}

// Cota linear (distance/width/height/edgeDistance — todas resolvem pro
// mesmo formato "2 pontos") com linha de extensão + seta em cada ponta,
// ao estilo da cota da folha de desenho. Puramente apresentacional — o
// arrasto do offset é decidido em handleRawDown/Move/Up (ver
// findDimensionHit em store.ts), roteado pelo MESMO InteractivePlane que já
// capta todo o resto da interação do esboço; não tem mesh de arrasto
// próprio aqui (evita competir com o InteractivePlane por raycasting).
// Props repassadas direto pro DimensionLabel sem lógica própria — extraídas
// num type só pra não repetir a mesma lista 2x (Distance e Radius groups).
type DimensionLabelLinkProps = {
  isReference?: boolean;
  isFormula?: boolean;
  isPickingSource?: boolean;
  isPickTarget?: boolean;
  onToggleReference?: () => void;
  onStartFormula?: (currentText: string) => void;
  onDragStart?: () => void;
  onDragMove?: (raw: LocalPoint) => void;
  onDragEnd?: (raw: LocalPoint | null) => void;
};

function DimensionDistanceGroup({
  plane,
  a,
  b,
  offset,
  labelT,
  label,
  numericValue,
  formulaText,
  editing,
  onStartEdit,
  onCommitEdit,
  onCancelEdit,
  onRemove,
  ...linkProps
}: {
  plane: SketchPlane;
  a: LocalPoint;
  b: LocalPoint;
  offset: number;
  labelT?: number;
  label: string;
  numericValue?: number;
  formulaText?: string;
  editing?: boolean;
  onStartEdit?: () => void;
  onCommitEdit?: (rawText: string) => void;
  onCancelEdit?: () => void;
  onRemove?: () => void;
} & DimensionLabelLinkProps) {
  const geo = computeDimensionLineGeometry(a, b, offset, labelT);
  if (!geo) return null;

  const toWorld = (local: LocalPoint): Vec3 => localToWorldPoint(plane, local);

  return (
    <group>
      <Line points={[toWorld(geo.extAStart), toWorld(geo.extAEnd)]} color={DIMENSION_COLOR} lineWidth={0.75} />
      <Line points={[toWorld(geo.extBStart), toWorld(geo.extBEnd)]} color={DIMENSION_COLOR} lineWidth={0.75} />
      <Line points={[toWorld(geo.dimA), toWorld(geo.dimB)]} color={DIMENSION_COLOR} lineWidth={1.5} />
      <Arrowhead3D points={geo.arrowA} toWorld={toWorld} color={DIMENSION_COLOR} />
      <Arrowhead3D points={geo.arrowB} toWorld={toWorld} color={DIMENSION_COLOR} />
      <DimensionLabel
        position={toWorld(geo.labelPos)}
        plane={plane}
        text={label}
        numericValue={numericValue}
        formulaText={formulaText}
        editing={editing}
        onStartEdit={onStartEdit}
        onCommitEdit={onCommitEdit}
        onCancelEdit={onCancelEdit}
        onRemove={onRemove}
        {...linkProps}
      />
    </group>
  );
}

// Cota de raio (radius/arcRadius/slotRadius) — linha de referência do centro
// até a borda (mostra o raio em si) + uma extensão além da borda, com seta
// encostando nela, ao estilo de cota de raio de desenho técnico. Offset
// negativo puxa o rótulo pra dentro do círculo. Também puramente
// apresentacional, mesma razão da DimensionDistanceGroup acima.
function DimensionRadiusGroup({
  plane,
  cx,
  cy,
  r,
  offset,
  angle,
  label,
  numericValue,
  formulaText,
  editing,
  onStartEdit,
  onCommitEdit,
  onCancelEdit,
  onRemove,
  ...linkProps
}: {
  plane: SketchPlane;
  cx: number;
  cy: number;
  r: number;
  offset: number;
  angle?: number;
  label: string;
  numericValue?: number;
  formulaText?: string;
  editing?: boolean;
  onStartEdit?: () => void;
  onCommitEdit?: (rawText: string) => void;
  onCancelEdit?: () => void;
  onRemove?: () => void;
} & DimensionLabelLinkProps) {
  const geo = computeRadiusDimensionGeometry(cx, cy, r, offset, angle);
  const toWorld = (local: LocalPoint): Vec3 => localToWorldPoint(plane, local);

  return (
    <group>
      <Line points={[toWorld({ x: cx, y: cy }), toWorld(geo.edge)]} color={DIMENSION_COLOR} lineWidth={1} />
      <Line points={[toWorld(geo.edge), toWorld(geo.tip)]} color={DIMENSION_COLOR} lineWidth={1.5} />
      <Arrowhead3D points={geo.arrow} toWorld={toWorld} color={DIMENSION_COLOR} />
      <DimensionLabel
        position={toWorld(geo.tip)}
        plane={plane}
        text={label}
        numericValue={numericValue}
        formulaText={formulaText}
        editing={editing}
        onStartEdit={onStartEdit}
        onCommitEdit={onCommitEdit}
        onCancelEdit={onCancelEdit}
        onRemove={onRemove}
        {...linkProps}
      />
    </group>
  );
}

function renderableToThree(shape: RenderableShape, toWorld: (p: LocalPoint) => Vec3, color: string, dashed = false) {
  if (shape.kind === "slot") {
    const pts = slotOutline(shape.c1x, shape.c1y, shape.c2x, shape.c2y, shape.r).map(toWorld);
    return <Line points={pts} color={color} lineWidth={1.5} dashed={dashed} dashSize={dashed ? 4 : undefined} gapSize={dashed ? 3 : undefined} />;
  }


  if (shape.kind === "point") {
    return (
      <mesh position={toWorld({ x: shape.cx, y: shape.cy })}>
        <sphereGeometry args={[1.6, 12, 12]} />
        <meshBasicMaterial color={color} />
      </mesh>
    );
  }

  if (shape.kind === "circle") {
    return (
      <Line points={circlePoints({ x: shape.cx, y: shape.cy }, shape.r).map(toWorld)} color={color} lineWidth={1.5} />
    );
  }

  if (shape.kind === "arc") {
    const pts = sampleMinorArc(shape.cx, shape.cy, shape.r, shape.x1, shape.y1, shape.x2, shape.y2, 24);
    return <Line points={pts.map(toWorld)} color={color} lineWidth={1.5} />;
  }

  if (shape.kind === "rect") {
    const corners = [
      { x: shape.x1, y: shape.y1 },
      { x: shape.x2, y: shape.y1 },
      { x: shape.x2, y: shape.y2 },
      { x: shape.x1, y: shape.y2 },
      { x: shape.x1, y: shape.y1 },
    ].map(toWorld);
    return <Line points={corners} color={color} lineWidth={1.5} dashed={dashed} dashSize={dashed ? 4 : undefined} gapSize={dashed ? 3 : undefined} />;
  }

  // line / centerline
  const isCenter = shape.kind === "centerline";
  return (
    <Line
      points={[toWorld({ x: shape.x1, y: shape.y1 }), toWorld({ x: shape.x2, y: shape.y2 })]}
      color={isCenter ? CENTERLINE_COLOR : color}
      lineWidth={isCenter ? 1 : 1.5}
      dashed={isCenter || dashed}
      dashSize={isCenter || dashed ? 4 : undefined}
      gapSize={isCenter || dashed ? 2 : undefined}
    />
  );
}

export function SketchOverlay3D({
  plane,
  referenceGeometry,
  interactive = false,
}: {
  plane: SketchPlane;
  referenceGeometry: ReferenceSegment[];
  // Fase 2: quando true, adiciona o plano raycastável que desenha/seleciona
  // diretamente no viewport 3D (além de só mostrar o esboço).
  interactive?: boolean;
}) {
  const shapes = useSketchStore((s) => s.shapes);
  const points = useSketchStore((s) => s.points);
  const dimensions = useSketchStore((s) => s.dimensions);
  const tool = useSketchStore((s) => s.tool);
  const downRaw = useSketchStore((s) => s.downRaw);
  const draftPoint = useSketchStore((s) => s.draftPoint);
  const alignmentGuides = useSketchStore((s) => s.alignmentGuides);
  const selectedShapeId = useSketchStore((s) => s.selectedShapeId);
  const multiProfileSelection = useSketchStore((s) => s.multiProfileSelection);
  const pendingConstraint = useSketchStore((s) => s.pendingConstraint);
  const pendingSlot = useSketchStore((s) => s.pendingSlot);
  const dimensionPick1 = useSketchStore((s) => s.dimensionPick1);
  const snapIndicator = useSketchStore((s) => s.snapIndicator);
  const dragPreview = useSketchStore((s) => s.dragPreview);
  const dragRadiusPreview = useSketchStore((s) => s.dragRadiusPreview);
  const removeDimension = useSketchStore((s) => s.removeDimension);
  const updateDimensionValue = useSketchStore((s) => s.updateDimensionValue);
  const toggleReferenceDimension = useSketchStore((s) => s.toggleReferenceDimension);
  const ensureParamName = useSketchStore((s) => s.ensureParamName);
  // Qual cota está com o <input> inline aberto — estado só de UI, não é
  // dado do sketch (nunca entra na store), então some sozinho se o
  // componente desmontar sem confirmar.
  const [editingDimensionId, setEditingDimensionId] = useState<string | null>(null);
  // Fórmula em montagem ao estilo Inventor: dimensionId é a cota de ORIGEM
  // (a que vai ganhar a fórmula), buffer é o texto acumulado até agora
  // (tudo que já tinha sido digitado antes de apertar "="). Enquanto isso
  // não é null, clicar em OUTRA cota insere o paramName dela no buffer e
  // reabre a edição da origem já preenchida (ver formulaDraft) — clicar na
  // PRÓPRIA origem cancela. Só UI, nunca entra na store.
  const [pickingFormula, setPickingFormula] = useState<{ dimensionId: string; buffer: string } | null>(null);
  // Texto que a edição reaberta depois de escolher uma referência deve
  // mostrar (em vez do valor/fórmula já salvos) — limpo assim que a edição
  // é confirmada/cancelada.
  const [formulaDraft, setFormulaDraft] = useState<{ dimensionId: string; text: string } | null>(null);
  const dimensionDrag = useSketchStore((s) => s.dimensionDrag);
  const dimensionDragPreview = useSketchStore((s) => s.dimensionDragPreview);
  const armDimensionDrag = useSketchStore((s) => s.armDimensionDrag);
  const cancelDimensionDrag = useSketchStore((s) => s.cancelDimensionDrag);
  // handleRawMove/Up já é o MESMO pipeline que o InteractivePlane usa —
  // reaproveitado aqui pro arrasto que começa no próprio rótulo da cota
  // (ver onDragStart/Move/End em DimensionLabel), que não passa pelo
  // pointerdown do plano (Html é DOM de verdade, fora do raycasting do
  // canvas) e por isso precisa da sua PRÓPRIA conversão tela→mundo (ver
  // screenToLocalPoint) — mas dali em diante é a mesma máquina de sempre.
  const handleRawMove = useSketchStore((s) => s.handleRawMove);
  const handleRawUp = useSketchStore((s) => s.handleRawUp);
  const measurement = useSketchStore((s) => s.measurement);

  const toWorld = (local: LocalPoint): Vec3 => localToWorldPoint(plane, local);

  // Durante um arrasto da ferramenta Selecionar, mostra a posição em
  // preview sem tocar na store — mesma ideia do editor 2D, pra atualizar
  // ao vivo mesmo quando o arrasto começou no outro painel.
  const renderPoints: Record<string, SketchPoint> =
    Object.keys(dragPreview).length > 0
      ? Object.fromEntries(
          Object.entries(points).map(([id, p]) => {
            const override = dragPreview[id];
            return [id, override ? { id, x: override.x, y: override.y } : p];
          })
        )
      : points;

  const renderShapes = dragRadiusPreview
    ? shapes.map((s) =>
        s.type === "circle" && s.id === dragRadiusPreview.shapeId
          ? { ...s, radius: dragRadiusPreview.radius }
          : s
      )
    : shapes;

  const draftShape =
    draftPoint &&
    downRaw &&
    (tool === "line" || tool === "centerline" || tool === "rect" || tool === "circle")
      ? draftPreviewFor(tool, downRaw, draftPoint)
      : null;

  return (
    <group>
      {interactive && <PlaneHighlight plane={plane} />}
      {interactive && <OriginMarker plane={plane} />}
      {interactive && <InteractivePlane plane={plane} referenceGeometry={referenceGeometry} />}

      {renderShapes.map((shape) => {
        const resolved = resolveShape(shape, renderPoints);
        if (!resolved) return null;
        // "joinPoints" (Coincidente) só destaca a forma aqui quando o 1º
        // clique foi numa LINHA (firstKind) — 1º clique num PONTO usa o
        // marcador esférico separado logo abaixo, já que um ponto não é
        // uma "forma" com id próprio pra bater em shape.id.
        const isPendingFirst =
          interactive &&
          ((pendingConstraint?.kind !== "joinPoints" && pendingConstraint?.firstId === shape.id) ||
            (pendingConstraint?.kind === "joinPoints" && pendingConstraint.firstKind === "line" && pendingConstraint.firstId === shape.id));
        const isPendingEdge = interactive && dimensionPick1?.shapeId === shape.id;
        const selected = interactive && (shape.id === selectedShapeId || isPendingFirst || isPendingEdge);
        const inProfileSelection = interactive && multiProfileSelection.includes(shape.id);
        const isProjected = shape.type === "line" && shape.isProjected;
        const color = selected
          ? SELECTED_COLOR
          : inProfileSelection
            ? PROFILE_SELECTED_COLOR
            : isProjected
              ? PROJECTED_COLOR
              : GEOMETRY_COLOR;
        return (
          <group key={shape.id}>
            {renderableToThree(resolved, toWorld, color)}
            {shape.type === "slot" && renderPoints[shape.center1] && renderPoints[shape.center2] && (
              <SlotConstructionAxis plane={plane} c1={renderPoints[shape.center1]} c2={renderPoints[shape.center2]} />
            )}
          </group>
        );
      })}

      {interactive &&
        pendingConstraint?.kind === "joinPoints" &&
        pendingConstraint.firstKind === "point" &&
        renderPoints[pendingConstraint.firstId] && (
          <mesh position={toWorld(renderPoints[pendingConstraint.firstId])}>
            <sphereGeometry args={[2.4, 12, 12]} />
            <meshBasicMaterial color={SELECTED_COLOR} wireframe />
          </mesh>
        )}

      {dimensions.map((dim) => {
        const render = resolveDimension(dim, renderShapes, renderPoints);
        if (!render) return null;
        // Enquanto ESSA cota está sendo arrastada (ver findDimensionHit/
        // handleRawDown em store.ts), usa o offset/labelT/angle de PREVIEW
        // ao vivo em vez do salvo — só confirma no store no pointerup
        // (handleRawUp).
        const isDraggingThis = dimensionDrag?.dimensionId === dim.id && dimensionDragPreview !== null;
        const offset = isDraggingThis ? dimensionDragPreview.offset : (dim.offset ?? DEFAULT_DIM_OFFSET);
        const labelT = isDraggingThis && "labelT" in dimensionDragPreview ? dimensionDragPreview.labelT : dim.labelT;
        const angle = isDraggingThis && "angle" in dimensionDragPreview ? dimensionDragPreview.angle : dim.angle;

        // Modo "montar fórmula" ativo (pickingFormula setado) e essa NÃO é
        // a cota de origem — clicar no valor insere o paramName dela na
        // fórmula em andamento em vez de abrir edição (ver onStartEdit).
        const isPickTarget = interactive && pickingFormula !== null && pickingFormula.dimensionId !== dim.id;
        const isPickingSource = pickingFormula?.dimensionId === dim.id;
        const linkProps = {
          isReference: dim.isReference,
          isFormula: !!dim.formula,
          isPickingSource,
          isPickTarget,
          onToggleReference: interactive ? () => toggleReferenceDimension(dim.id) : undefined,
          onStartFormula: interactive
            ? (currentText: string) => {
                setEditingDimensionId(null);
                setFormulaDraft(null);
                setPickingFormula({ dimensionId: dim.id, buffer: currentText });
              }
            : undefined,
          // Arrastar o rótulo em si (não só a linha, ver findDimensionHit
          // em store.ts) — mesma dinâmica da cota da folha de desenho 2D.
          onDragStart: interactive ? () => armDimensionDrag(dim) : undefined,
          onDragMove: interactive ? (raw: LocalPoint) => handleRawMove(raw) : undefined,
          onDragEnd: interactive
            ? (raw: LocalPoint | null) => (raw ? handleRawUp(raw) : cancelDimensionDrag())
            : undefined,
        };
        const onStartEdit = interactive
          ? () => {
              if (isPickTarget) {
                const paramName = ensureParamName(dim.id);
                const { dimensionId, buffer } = pickingFormula!;
                setPickingFormula(null);
                setFormulaDraft({ dimensionId, text: buffer + paramName });
                setEditingDimensionId(dimensionId);
                return;
              }
              if (isPickingSource) {
                // Clicar na própria cota que está montando a fórmula cancela.
                setPickingFormula(null);
                return;
              }
              if (dim.isReference) return;
              setFormulaDraft(null);
              setEditingDimensionId(dim.id);
            }
          : undefined;
        const onCommitEdit = (rawText: string) => {
          setEditingDimensionId(null);
          setFormulaDraft(null);
          updateDimensionValue(dim, rawText);
        };
        const formulaText = formulaDraft?.dimensionId === dim.id ? formulaDraft.text : dim.formula;

        if (render.kind === "radius") {
          return (
            <DimensionRadiusGroup
              key={dim.id}
              plane={plane}
              cx={render.cx}
              cy={render.cy}
              r={render.r}
              offset={offset}
              angle={angle}
              label={`R${render.r.toFixed(1)}`}
              numericValue={render.r}
              formulaText={formulaText}
              editing={editingDimensionId === dim.id}
              onStartEdit={onStartEdit}
              onCommitEdit={onCommitEdit}
              onCancelEdit={() => {
                setEditingDimensionId(null);
                setFormulaDraft(null);
              }}
              onRemove={interactive ? () => removeDimension(dim.id) : undefined}
              {...linkProps}
            />
          );
        }

        const length = Math.hypot(render.x2 - render.x1, render.y2 - render.y1);
        return (
          <DimensionDistanceGroup
            key={dim.id}
            plane={plane}
            a={{ x: render.x1, y: render.y1 }}
            b={{ x: render.x2, y: render.y2 }}
            offset={offset}
            labelT={labelT}
            label={length.toFixed(1)}
            numericValue={length}
            formulaText={formulaText}
            editing={editingDimensionId === dim.id}
            onStartEdit={onStartEdit}
            onCommitEdit={onCommitEdit}
            onCancelEdit={() => {
              setEditingDimensionId(null);
              setFormulaDraft(null);
            }}
            onRemove={interactive ? () => removeDimension(dim.id) : undefined}
            {...linkProps}
          />
        );
      })}

      {interactive && measurement && (
        <group>
          <Line
            points={[toWorld({ x: measurement.x1, y: measurement.y1 }), toWorld({ x: measurement.x2, y: measurement.y2 })]}
            color={MEASURE_COLOR}
            lineWidth={1}
            dashed
            dashSize={3}
            gapSize={2}
          />
          <DimensionLabel
            position={toWorld({
              x: (measurement.x1 + measurement.x2) / 2,
              y: (measurement.y1 + measurement.y2) / 2,
            })}
            text={Math.hypot(measurement.x2 - measurement.x1, measurement.y2 - measurement.y1).toFixed(1)}
          />
        </group>
      )}

      {interactive && draftShape && <group>{renderableToThree(draftShape, toWorld, DRAFT_COLOR, true)}</group>}

      {interactive && pendingSlot?.kind === "centerToCenter" && renderPoints[pendingSlot.center1Id] && (
        <group>
          {draftPoint ? (
            <SlotConstructionAxis plane={plane} c1={renderPoints[pendingSlot.center1Id]} c2={draftPoint} />
          ) : (
            <mesh position={toWorld(renderPoints[pendingSlot.center1Id])}>
              <sphereGeometry args={[1.4, 10, 10]} />
              <meshBasicMaterial color={CENTERLINE_COLOR} />
            </mesh>
          )}
        </group>
      )}

      {interactive && pendingSlot?.kind === "centerPoint" && (
        <group>
          {draftPoint ? (
            <SlotConstructionAxis plane={plane} c1={pendingSlot.midpoint} c2={draftPoint} />
          ) : (
            <mesh position={toWorld(pendingSlot.midpoint)}>
              <sphereGeometry args={[1.4, 10, 10]} />
              <meshBasicMaterial color={CENTERLINE_COLOR} />
            </mesh>
          )}
        </group>
      )}

      {interactive && alignmentGuides && draftPoint && (
        <group>
          {alignmentGuides.x && (
            <>
              <Line
                points={[
                  toWorld({ x: alignmentGuides.x.at, y: Math.min(alignmentGuides.x.ref.y, draftPoint.y) - ALIGN_GUIDE_MARGIN }),
                  toWorld({ x: alignmentGuides.x.at, y: Math.max(alignmentGuides.x.ref.y, draftPoint.y) + ALIGN_GUIDE_MARGIN }),
                ]}
                color={ALIGN_GUIDE_COLOR}
                lineWidth={1}
                dashed
                dashSize={2}
                gapSize={1.5}
              />
              <mesh position={toWorld(alignmentGuides.x.ref)}>
                <sphereGeometry args={[1.6, 10, 10]} />
                <meshBasicMaterial color={ALIGN_GUIDE_COLOR} />
              </mesh>
            </>
          )}
          {alignmentGuides.y && (
            <>
              <Line
                points={[
                  toWorld({ x: Math.min(alignmentGuides.y.ref.x, draftPoint.x) - ALIGN_GUIDE_MARGIN, y: alignmentGuides.y.at }),
                  toWorld({ x: Math.max(alignmentGuides.y.ref.x, draftPoint.x) + ALIGN_GUIDE_MARGIN, y: alignmentGuides.y.at }),
                ]}
                color={ALIGN_GUIDE_COLOR}
                lineWidth={1}
                dashed
                dashSize={2}
                gapSize={1.5}
              />
              <mesh position={toWorld(alignmentGuides.y.ref)}>
                <sphereGeometry args={[1.6, 10, 10]} />
                <meshBasicMaterial color={ALIGN_GUIDE_COLOR} />
              </mesh>
            </>
          )}
        </group>
      )}

      {interactive &&
        pendingSlot?.kind === "ready" &&
        draftPoint &&
        renderPoints[pendingSlot.center1Id] &&
        renderPoints[pendingSlot.center2Id] &&
        (() => {
          const c1 = renderPoints[pendingSlot.center1Id];
          const c2 = renderPoints[pendingSlot.center2Id];
          const radius = perpendicularDistanceToLine(draftPoint, c1, c2);
          return (
            <group>
              {renderableToThree({ kind: "slot", c1x: c1.x, c1y: c1.y, c2x: c2.x, c2y: c2.y, r: radius }, toWorld, DRAFT_COLOR, true)}
              <SlotConstructionAxis plane={plane} c1={c1} c2={c2} />
            </group>
          );
        })()}

      {interactive && snapIndicator && (
        <mesh position={toWorld(snapIndicator)}>
          <sphereGeometry args={[2, 12, 12]} />
          <meshBasicMaterial color={SNAP_COLOR} wireframe />
        </mesh>
      )}
    </group>
  );
}

"use client";

import { useMemo } from "react";
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
const CENTERLINE_COLOR = "#607d8b";
const DIMENSION_COLOR = "#455a64";
const MEASURE_COLOR = "#d97706";
const SELECTED_COLOR = "#e53935";
const DRAFT_COLOR = "#607d8b";
const SNAP_COLOR = "#2e7d32";
const PLANE_COLOR = "#4fc3f7";
const PLANE_HALF_SIZE = 200; // mm — mesmo tamanho do mundo do esboço 2D
const INTERACTIVE_PLANE_SIZE = 4000; // bem maior que o destaque visual, pra sobrar espaço pra desenhar
const CIRCLE_SEGMENTS = 48;

type Vec3 = [number, number, number];
type LocalPoint = { x: number; y: number };
type ReferenceSegment = { x1: number; y1: number; x2: number; y2: number };

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
        handleRawDown(toRaw(e), referenceGeometry);
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

// Rótulo clicável de uma cota, igual à ideia do editor 2D: clicar no valor
// edita (prompt), clicar no × remove. Html do drei já é DOM normal (não
// passa pelo raycasting do canvas), então não precisa do mesmo cuidado de
// stopPropagation contra o pointerdown do plano interativo que o SVG
// precisava — só o clique nativo mesmo.
function DimensionLabel({
  position,
  text,
  onEdit,
  onRemove,
}: {
  position: Vec3;
  text: string;
  onEdit?: () => void;
  onRemove?: () => void;
}) {
  return (
    // distanceFactor controla o tamanho "no mundo": drei escala o HTML por
    // objectScale(câmera) * distanceFactor, onde objectScale ~ 1/distância
    // — ou seja, o rótulo cresce ao aproximar e encolhe ao afastar, do
    // mesmo jeito que a peça na tela (proporcional ao zoom). 220 deixa o
    // texto em tamanho natural (~100%) na distância padrão da câmera ao
    // focar um plano (260mm); valor bem maior que o anterior (60), que
    // deixava a caixa pequena demais mesmo na distância normal de trabalho.
    <Html position={position} center distanceFactor={220} pointerEvents="auto">
      <span className="flex items-center gap-1.5 whitespace-nowrap rounded-full border border-primary-200 bg-white px-3 py-1.5 text-base font-bold text-primary-900 shadow-md">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onEdit?.();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className={onEdit ? "cursor-pointer hover:underline" : ""}
        >
          {text}
        </button>
        {onRemove && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className="cursor-pointer rounded-full px-1 text-primary-400 hover:bg-error/10 hover:text-error"
          >
            ×
          </button>
        )}
      </span>
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
function DimensionDistanceGroup({
  plane,
  a,
  b,
  offset,
  label,
  onEdit,
  onRemove,
}: {
  plane: SketchPlane;
  a: LocalPoint;
  b: LocalPoint;
  offset: number;
  label: string;
  onEdit?: () => void;
  onRemove?: () => void;
}) {
  const geo = computeDimensionLineGeometry(a, b, offset);
  if (!geo) return null;

  const toWorld = (local: LocalPoint): Vec3 => localToWorldPoint(plane, local);

  return (
    <group>
      <Line points={[toWorld(geo.extAStart), toWorld(geo.extAEnd)]} color={DIMENSION_COLOR} lineWidth={0.75} />
      <Line points={[toWorld(geo.extBStart), toWorld(geo.extBEnd)]} color={DIMENSION_COLOR} lineWidth={0.75} />
      <Line points={[toWorld(geo.dimA), toWorld(geo.dimB)]} color={DIMENSION_COLOR} lineWidth={1.5} />
      <Arrowhead3D points={geo.arrowA} toWorld={toWorld} color={DIMENSION_COLOR} />
      <Arrowhead3D points={geo.arrowB} toWorld={toWorld} color={DIMENSION_COLOR} />
      <DimensionLabel position={toWorld(geo.mid)} text={label} onEdit={onEdit} onRemove={onRemove} />
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
  label,
  onEdit,
  onRemove,
}: {
  plane: SketchPlane;
  cx: number;
  cy: number;
  r: number;
  offset: number;
  label: string;
  onEdit?: () => void;
  onRemove?: () => void;
}) {
  const geo = computeRadiusDimensionGeometry(cx, cy, r, offset);
  const toWorld = (local: LocalPoint): Vec3 => localToWorldPoint(plane, local);

  return (
    <group>
      <Line points={[toWorld({ x: cx, y: cy }), toWorld(geo.edge)]} color={DIMENSION_COLOR} lineWidth={1} />
      <Line points={[toWorld(geo.edge), toWorld(geo.tip)]} color={DIMENSION_COLOR} lineWidth={1.5} />
      <Arrowhead3D points={geo.arrow} toWorld={toWorld} color={DIMENSION_COLOR} />
      <DimensionLabel position={toWorld(geo.tip)} text={label} onEdit={onEdit} onRemove={onRemove} />
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
  const selectedShapeId = useSketchStore((s) => s.selectedShapeId);
  const pendingConstraint = useSketchStore((s) => s.pendingConstraint);
  const pendingSlot = useSketchStore((s) => s.pendingSlot);
  const dimensionPick1 = useSketchStore((s) => s.dimensionPick1);
  const snapIndicator = useSketchStore((s) => s.snapIndicator);
  const dragPreview = useSketchStore((s) => s.dragPreview);
  const dragRadiusPreview = useSketchStore((s) => s.dragRadiusPreview);
  const removeDimension = useSketchStore((s) => s.removeDimension);
  const promptEditDimension = useSketchStore((s) => s.promptEditDimension);
  const dimensionDrag = useSketchStore((s) => s.dimensionDrag);
  const dimensionDragPreview = useSketchStore((s) => s.dimensionDragPreview);
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
      {interactive && <InteractivePlane plane={plane} referenceGeometry={referenceGeometry} />}

      {renderShapes.map((shape) => {
        const resolved = resolveShape(shape, renderPoints);
        if (!resolved) return null;
        const isPendingFirst = interactive && pendingConstraint?.kind !== "joinPoints" && pendingConstraint?.firstId === shape.id;
        const isPendingEdge = interactive && dimensionPick1?.shapeId === shape.id;
        const selected = interactive && (shape.id === selectedShapeId || isPendingFirst || isPendingEdge);
        return (
          <group key={shape.id}>{renderableToThree(resolved, toWorld, selected ? SELECTED_COLOR : GEOMETRY_COLOR)}</group>
        );
      })}

      {interactive && pendingConstraint?.kind === "joinPoints" && renderPoints[pendingConstraint.firstId] && (
        <mesh position={toWorld(renderPoints[pendingConstraint.firstId])}>
          <sphereGeometry args={[2.4, 12, 12]} />
          <meshBasicMaterial color={SELECTED_COLOR} wireframe />
        </mesh>
      )}

      {dimensions.map((dim) => {
        const render = resolveDimension(dim, renderShapes, renderPoints);
        if (!render) return null;
        // Enquanto ESSA cota está sendo arrastada (ver findDimensionHit/
        // handleRawDown em store.ts), usa o offset de PREVIEW ao vivo em vez
        // do salvo — só confirma no store no pointerup (handleRawUp).
        const offset =
          dimensionDrag?.dimensionId === dim.id && dimensionDragPreview !== null
            ? dimensionDragPreview
            : (dim.offset ?? DEFAULT_DIM_OFFSET);

        if (render.kind === "radius") {
          return (
            <DimensionRadiusGroup
              key={dim.id}
              plane={plane}
              cx={render.cx}
              cy={render.cy}
              r={render.r}
              offset={offset}
              label={`R${render.r.toFixed(1)}`}
              onEdit={interactive ? () => promptEditDimension(dim, render.r) : undefined}
              onRemove={interactive ? () => removeDimension(dim.id) : undefined}
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
            label={length.toFixed(1)}
            onEdit={interactive ? () => promptEditDimension(dim, length) : undefined}
            onRemove={interactive ? () => removeDimension(dim.id) : undefined}
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
          <mesh position={toWorld(renderPoints[pendingSlot.center1Id])}>
            <sphereGeometry args={[2, 12, 12]} />
            <meshBasicMaterial color={SELECTED_COLOR} wireframe />
          </mesh>
          {draftPoint && (
            <Line
              points={[toWorld(renderPoints[pendingSlot.center1Id]), toWorld(draftPoint)]}
              color={DRAFT_COLOR}
              lineWidth={1}
              dashed
              dashSize={3}
              gapSize={2}
            />
          )}
        </group>
      )}

      {interactive && pendingSlot?.kind === "centerPoint" && (
        <group>
          <mesh position={toWorld(pendingSlot.midpoint)}>
            <sphereGeometry args={[2, 12, 12]} />
            <meshBasicMaterial color={SELECTED_COLOR} wireframe />
          </mesh>
          {draftPoint && (
            <Line
              points={[toWorld(pendingSlot.midpoint), toWorld(draftPoint)]}
              color={DRAFT_COLOR}
              lineWidth={1}
              dashed
              dashSize={3}
              gapSize={2}
            />
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

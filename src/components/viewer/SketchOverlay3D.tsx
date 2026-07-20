"use client";

import { useMemo } from "react";
import { Line, Html } from "@react-three/drei";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { localToWorldPoint, worldToLocalPoint } from "@/lib/replicad/plane";
import { planeBasisQuaternion } from "./planeBasis";
import { useSketchStore } from "@/lib/sketch/store";
import { resolveDimension, resolveShape, draftPreviewFor, sampleMinorArc, type RenderableShape } from "@/lib/sketch/render";
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
        <button type="button" onClick={onEdit} className={onEdit ? "cursor-pointer hover:underline" : ""}>
          {text}
        </button>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="cursor-pointer rounded-full px-1 text-primary-400 hover:bg-error/10 hover:text-error"
          >
            ×
          </button>
        )}
      </span>
    </Html>
  );
}

function renderableToThree(shape: RenderableShape, toWorld: (p: LocalPoint) => Vec3, color: string, dashed = false) {
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
  const snapIndicator = useSketchStore((s) => s.snapIndicator);
  const dragPreview = useSketchStore((s) => s.dragPreview);
  const dragRadiusPreview = useSketchStore((s) => s.dragRadiusPreview);
  const removeDimension = useSketchStore((s) => s.removeDimension);
  const promptEditDimension = useSketchStore((s) => s.promptEditDimension);
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
        const selected = interactive && (shape.id === selectedShapeId || isPendingFirst);
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

        if (render.kind === "radius") {
          const edge = { x: render.cx + render.r * Math.SQRT1_2, y: render.cy + render.r * Math.SQRT1_2 };
          return (
            <group key={dim.id}>
              <Line points={[toWorld({ x: render.cx, y: render.cy }), toWorld(edge)]} color={DIMENSION_COLOR} lineWidth={1} />
              <DimensionLabel
                position={toWorld(edge)}
                text={`R${render.r.toFixed(1)}`}
                onEdit={interactive ? () => promptEditDimension(dim, render.r) : undefined}
                onRemove={interactive ? () => removeDimension(dim.id) : undefined}
              />
            </group>
          );
        }

        const length = Math.hypot(render.x2 - render.x1, render.y2 - render.y1);
        const mid = { x: (render.x1 + render.x2) / 2, y: (render.y1 + render.y2) / 2 };
        return (
          <group key={dim.id}>
            <Line
              points={[toWorld({ x: render.x1, y: render.y1 }), toWorld({ x: render.x2, y: render.y2 })]}
              color={DIMENSION_COLOR}
              lineWidth={1}
              dashed
              dashSize={2}
              gapSize={1.2}
            />
            <DimensionLabel
              position={toWorld(mid)}
              text={length.toFixed(1)}
              onEdit={interactive ? () => promptEditDimension(dim, length) : undefined}
              onRemove={interactive ? () => removeDimension(dim.id) : undefined}
            />
          </group>
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

      {interactive && snapIndicator && (
        <mesh position={toWorld(snapIndicator)}>
          <sphereGeometry args={[2, 12, 12]} />
          <meshBasicMaterial color={SNAP_COLOR} wireframe />
        </mesh>
      )}
    </group>
  );
}

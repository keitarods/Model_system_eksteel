import { Plane as ReplicadPlane } from "replicad";
import { BASE_SKETCH_PLANE } from "@/lib/sketch/types";
import type { Point, SketchPlane } from "@/lib/sketch/types";

type Vec3 = [number, number, number];

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

// Direção X arbitrária mas determinística, perpendicular à normal — não
// depende do comportamento default do construtor do Plane (mais previsível
// já que não dá pra testar isso interativamente num browser real agora).
function computeXDir(normal: Vec3): Vec3 {
  const reference: Vec3 = Math.abs(normal[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  return normalize(cross(reference, normal));
}

export function planeYDir(plane: SketchPlane): Vec3 {
  return normalize(cross(plane.normal, plane.xDir));
}

// Converte um ponto 2D local do sketch (coordenadas dentro do plano) pra
// coordenadas de mundo — usado pra levar a origem da linha de centro do
// espaço local até o eixo de revolução real.
export function localToWorldPoint(plane: SketchPlane, local: Point): Vec3 {
  const yDir = planeYDir(plane);
  return [
    plane.origin[0] + plane.xDir[0] * local.x + yDir[0] * local.y,
    plane.origin[1] + plane.xDir[1] * local.x + yDir[1] * local.y,
    plane.origin[2] + plane.xDir[2] * local.x + yDir[2] * local.y,
  ];
}

// Mesma ideia, mas pra uma direção (ignora a translação do origin — só
// rotaciona a base local pra base de mundo).
export function localToWorldDirection(plane: SketchPlane, local: Point): Vec3 {
  const yDir = planeYDir(plane);
  return normalize([
    plane.xDir[0] * local.x + yDir[0] * local.y,
    plane.xDir[1] * local.x + yDir[1] * local.y,
    plane.xDir[2] * local.x + yDir[2] * local.y,
  ]);
}

// Inverso de localToWorldPoint: projeta um ponto de mundo nas coordenadas
// locais 2D do plano (ignora a componente fora do plano — é uma projeção
// ortogonal, não uma interseção exata). Usado pra mostrar a geometria do
// sólido existente como referência dentro do esboço 2D (ao estilo
// "Project Geometry" do Inventor), sem precisar desenhar o esboço dentro
// do viewer 3D.
export function worldToLocalPoint(plane: SketchPlane, world: Vec3): Point {
  const yDir = planeYDir(plane);
  const rel: Vec3 = [
    world[0] - plane.origin[0],
    world[1] - plane.origin[1],
    world[2] - plane.origin[2],
  ];
  return {
    x: rel[0] * plane.xDir[0] + rel[1] * plane.xDir[1] + rel[2] * plane.xDir[2],
    y: rel[0] * yDir[0] + rel[1] * yDir[1] + rel[2] * yDir[2],
  };
}

export function offsetOrigin(plane: SketchPlane, distance: number): Vec3 {
  return [
    plane.origin[0] + plane.normal[0] * distance,
    plane.origin[1] + plane.normal[1] * distance,
    plane.origin[2] + plane.normal[2] * distance,
  ];
}

export function negate(v: Vec3): Vec3 {
  return [-v[0], -v[1], -v[2]];
}

export function sketchPlaneFromHit(
  origin: Vec3,
  normal: Vec3
): SketchPlane {
  const normalizedNormal = normalize(normal);
  return {
    origin,
    normal: normalizedNormal,
    xDir: computeXDir(normalizedNormal),
  };
}

// Constrói o Plane do replicad (precisa de OpenCascade já carregado —
// chamar só depois de loadOpenCascade()).
export function toReplicadPlane(plane: SketchPlane): ReplicadPlane {
  return new ReplicadPlane(plane.origin, plane.xDir, plane.normal);
}

// Os 3 planos padrão de origem (ao estilo Inventor/SolidWorks) — mostrados
// como opções clicáveis ao criar um esboço, além de qualquer face de um
// sólido já existente. XY usa BASE_SKETCH_PLANE diretamente (mesmo xDir já
// estabelecido em todo o resto do app); XZ/YZ vêm de sketchPlaneFromHit
// (que já resolve um xDir consistente a partir só da normal).
export const STANDARD_PLANES: { id: "xy" | "xz" | "yz"; label: string; plane: SketchPlane }[] = [
  { id: "xy", label: "Plano XY", plane: BASE_SKETCH_PLANE },
  { id: "xz", label: "Plano XZ", plane: sketchPlaneFromHit([0, 0, 0], [0, 1, 0]) },
  { id: "yz", label: "Plano YZ", plane: sketchPlaneFromHit([0, 0, 0], [1, 0, 0]) },
];

// Os 3 eixos padrão de origem (ao estilo Inventor/SolidWorks: Eixo X/Y/Z) —
// mesma ideia dos 3 planos padrão acima, mas 1D: retas fixas passando pela
// origem do mundo ao longo de cada eixo principal.
export const STANDARD_AXES: { id: "x" | "y" | "z"; label: string; origin: Vec3; direction: Vec3 }[] = [
  { id: "x", label: "Eixo X", origin: [0, 0, 0], direction: [1, 0, 0] },
  { id: "y", label: "Eixo Y", origin: [0, 0, 0], direction: [0, 1, 0] },
  { id: "z", label: "Eixo Z", origin: [0, 0, 0], direction: [0, 0, 1] },
];

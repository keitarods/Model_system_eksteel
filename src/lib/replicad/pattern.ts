import type { Feature } from "@/lib/features/types";
import type { SketchPlane } from "@/lib/sketch/types";

// Transforma rígido (translação OU rotação em torno de um eixo) aplicado ao
// PLANO de uma feature padronizável — mover/rotacionar só o plano
// (origin/normal/xDir) já reposiciona corretamente o resto dos campos, que
// são todos LOCAIS a esse plano (profile 2D, center do furo, axisOrigin/
// axisDirection da revolução) e não precisam ser tocados individualmente.
export type PatternOffset =
  | { kind: "translate"; vector: Vec3 }
  | { kind: "rotate"; angleDeg: number; axisOrigin: Vec3; axisDirection: Vec3 };

type Vec3 = [number, number, number];

function addVec3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function normalize3(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

// Rotação de Rodrigues em torno de um eixo arbitrário (origin+direction) —
// usada tanto pra pontos (translada em relação a axisOrigin antes/depois de
// girar) quanto pra direções puras (chamada com axisOrigin=[0,0,0], que
// reduz a fórmula a girar o vetor sem deslocamento nenhum).
function rotateAroundAxis(p: Vec3, axisOrigin: Vec3, axisDirection: Vec3, angleDeg: number): Vec3 {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const k = normalize3(axisDirection);
  const v: Vec3 = [p[0] - axisOrigin[0], p[1] - axisOrigin[1], p[2] - axisOrigin[2]];
  const kDotV = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
  const kCrossV: Vec3 = [k[1] * v[2] - k[2] * v[1], k[2] * v[0] - k[0] * v[2], k[0] * v[1] - k[1] * v[0]];
  const rotated: Vec3 = [
    v[0] * cos + kCrossV[0] * sin + k[0] * kDotV * (1 - cos),
    v[1] * cos + kCrossV[1] * sin + k[1] * kDotV * (1 - cos),
    v[2] * cos + kCrossV[2] * sin + k[2] * kDotV * (1 - cos),
  ];
  return [rotated[0] + axisOrigin[0], rotated[1] + axisOrigin[1], rotated[2] + axisOrigin[2]];
}

function transformPoint(offset: PatternOffset, p: Vec3): Vec3 {
  return offset.kind === "translate" ? addVec3(p, offset.vector) : rotateAroundAxis(p, offset.axisOrigin, offset.axisDirection, offset.angleDeg);
}

function transformDirection(offset: PatternOffset, d: Vec3): Vec3 {
  return offset.kind === "translate" ? d : rotateAroundAxis(d, [0, 0, 0], offset.axisDirection, offset.angleDeg);
}

function transformPlane(plane: SketchPlane, offset: PatternOffset): SketchPlane {
  return {
    origin: transformPoint(offset, plane.origin),
    normal: transformDirection(offset, plane.normal),
    xDir: transformDirection(offset, plane.xDir),
  };
}

// Só os 4 tipos com um `plane` próprio e todo o resto local a ele são
// padronizáveis nessa v1 — Fillet/Chamfer (edgePoints em coordenadas de
// MUNDO) e Flange (nasce de uma aresta específica) ficariam errados sendo
// só "movidos de plano", precisariam de lógica própria; Varredura/Espiral/
// Padrão (recursivo) ficam de fora por simplicidade.
export type PatternableFeature = Extract<Feature, { type: "extrude" | "face" | "revolve" | "hole" }>;

export function isPatternable(feature: Feature): feature is PatternableFeature {
  return feature.type === "extrude" || feature.type === "face" || feature.type === "revolve" || feature.type === "hole";
}

export function applyPatternOffset<T extends PatternableFeature>(source: T, offset: PatternOffset): T {
  return { ...source, plane: transformPlane(source.plane, offset) };
}

// Lista de offsets pras cópias ADICIONAIS (exclui a instância original, já
// construída pela própria feature de origem em sua posição normal na
// árvore) — retangular varre uma grade count1 x count2 (count2 ausente ou
// <=1 = só 1 direção, padrão em linha); circular divide `angle` graus em
// `count` instâncias (360° = espaçamento angle/count, volta completa sem
// repetir a última em cima da primeira; menor que 360° = leque, espaçamento
// angle/(count-1) pra incluir as duas pontas).
export function computePatternOffsets(
  feature: Extract<Feature, { type: "pattern" }>
): PatternOffset[] {
  if (feature.kind === "rectangular") {
    const n1 = Math.max(1, Math.round(feature.count1));
    const n2 = feature.dir2 && feature.count2 ? Math.max(1, Math.round(feature.count2)) : 1;
    const offsets: PatternOffset[] = [];
    for (let i = 0; i < n1; i++) {
      for (let j = 0; j < n2; j++) {
        if (i === 0 && j === 0) continue;
        const vector: Vec3 = [
          feature.dir1[0] * feature.spacing1 * i + (feature.dir2 ? feature.dir2[0] * (feature.spacing2 ?? 0) * j : 0),
          feature.dir1[1] * feature.spacing1 * i + (feature.dir2 ? feature.dir2[1] * (feature.spacing2 ?? 0) * j : 0),
          feature.dir1[2] * feature.spacing1 * i + (feature.dir2 ? feature.dir2[2] * (feature.spacing2 ?? 0) * j : 0),
        ];
        offsets.push({ kind: "translate", vector });
      }
    }
    return offsets;
  }

  const n = Math.max(1, Math.round(feature.count));
  if (n <= 1) return [];
  const fullTurn = Math.abs(feature.angle - 360) < 1e-6;
  const step = fullTurn ? feature.angle / n : feature.angle / (n - 1);
  const offsets: PatternOffset[] = [];
  for (let i = 1; i < n; i++) {
    offsets.push({ kind: "rotate", angleDeg: step * i, axisOrigin: feature.axisOrigin, axisDirection: feature.axisDirection });
  }
  return offsets;
}

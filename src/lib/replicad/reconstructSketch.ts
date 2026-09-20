import { makeVertex, measureDistanceBetween, type Face, type Solid } from "replicad";
import type { SketchFeature } from "@/lib/features/types";
import type { Point } from "@/lib/sketch/types";
import { threePointArc } from "@/lib/sketch/modify";
import { sketchPlaneFromHit, worldToLocalPoint } from "./plane";

type Vec3 = [number, number, number];

/** Extract analytic boundaries, including holes. Never approximate unsupported curves silently. */
export function reconstructFaceSketch(solid: Solid, hit: Vec3, normal: Vec3, newId: () => string): SketchFeature {
  if (![...hit, ...normal].every(Number.isFinite) || Math.hypot(...normal) < 1e-9) throw new Error("Seleção de face inválida.");
  const faces = solid.faces;
  const vertex = makeVertex(hit);
  let selected: Face | undefined;
  try {
    let distance = 1e-4;
    for (const face of faces) {
      if (face.geomType !== "PLANE") continue;
      const direction = face.normalAt();
      const alignment = Math.abs((direction.x * normal[0] + direction.y * normal[1] + direction.z * normal[2]) / Math.hypot(...normal));
      direction.delete();
      if (alignment < .999) continue;
      const candidate = measureDistanceBetween(face, vertex);
      if (candidate <= distance) { selected = face; distance = candidate; }
    }
    if (!selected) throw new Error("Selecione uma face plana. Faces curvas não definem um esboço plano.");
    const center = selected.center, direction = selected.normalAt();
    const n: Vec3 = [direction.x, direction.y, direction.z];
    // Retain the clicked orientation while projecting its origin onto the exact face plane.
    if (n[0] * normal[0] + n[1] * normal[1] + n[2] * normal[2] < 0) for (let i = 0; i < 3; i++) n[i] *= -1;
    const offset = (hit[0] - center.x) * n[0] + (hit[1] - center.y) * n[1] + (hit[2] - center.z) * n[2];
    const faceCenter: Vec3 = [center.x, center.y, center.z];
    center.delete(); direction.delete();
    const plane = sketchPlaneFromHit([hit[0] - offset * n[0], hit[1] - offset * n[1], hit[2] - offset * n[2]], n);
    const localCenter = worldToLocalPoint(plane, faceCenter);
    const sketch: SketchFeature = { id: newId(), type: "sketch", label: "Esboço reconstruído da face", plane, points: {}, shapes: [], dimensions: [], constraints: [], fixedPointIds: [] };
    function point(value: Point): string {
      const match = Object.values(sketch.points).find(p => Math.hypot(p.x - value.x, p.y - value.y) < 1e-7);
      if (match) return match.id;
      const id = newId(); sketch.points[id] = { id, x: value.x, y: value.y }; return id;
    }
    const edges = selected.edges;
    try {
      if (edges.length > 1000) throw new Error("Face com mais de mil arestas; simplifique a geometria antes de reconstruir.");
      for (const edge of edges) {
        const at = (t: number) => { const v = edge.pointAt(t); const p = worldToLocalPoint(plane, [v.x, v.y, v.z]); v.delete(); return p; };
        if (edge.geomType === "LINE") {
          const p1 = point(at(0)), p2 = point(at(1));
          if (p1 === p2) throw new Error("Aresta degenerada na face.");
          sketch.shapes.push({ id: newId(), type: "line", p1, p2 });
          const a = sketch.points[p1], b = sketch.points[p2];
          const outward = -(b.y - a.y) * ((a.x + b.x) / 2 - localCenter.x) + (b.x - a.x) * ((a.y + b.y) / 2 - localCenter.y);
          sketch.dimensions.push({ id: newId(), kind: "distance", p1, p2, isReference: true, offset: outward < 0 ? -8 : 8 });
        } else if (edge.geomType === "CIRCLE") {
          const arc = threePointArc(at(0), at(edge.isClosed ? .25 : .5), at(edge.isClosed ? .5 : 1));
          const first = arc.shapes[0];
          if (first.type !== "arc") throw new Error("Contorno circular inválido.");
          if (edge.isClosed) {
            const centerPoint = arc.points[first.center], start = at(0);
            const id = newId();
            sketch.shapes.push({ id, type: "circle", center: point(centerPoint), radius: Math.hypot(start.x - centerPoint.x, start.y - centerPoint.y) });
            sketch.dimensions.push({ id: newId(), kind: "radius", circleId: id, isReference: true, isDiameter: true, offset: 8 });
          } else {
            for (const shape of arc.shapes) {
              if (shape.type !== "arc") continue;
              const id = newId();
              sketch.shapes.push({ id, type: "arc", p1: point(arc.points[shape.p1]), p2: point(arc.points[shape.p2]), center: point(arc.points[shape.center]) });
              sketch.dimensions.push({ id: newId(), kind: "arcRadius", arcId: id, isReference: true, offset: 8 });
            }
          }
        } else throw new Error(`A face contém ${edge.geomType}. Esta etapa reconstrói apenas retas, arcos e círculos, sem aproximar curvas.`);
      }
      if (!sketch.shapes.length) throw new Error("Face sem contorno utilizável.");
      return sketch;
    } finally { for (const edge of edges) edge.delete(); }
  } finally { vertex.delete(); for (const face of faces) face.delete(); }
}

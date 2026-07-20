import type { Solid } from "replicad";
import { sketchPlaneFromHit, worldToLocalPoint } from "./plane";
import { buildDxfFromSegments } from "@/lib/project/dxf";

type Segment = { x1: number; y1: number; x2: number; y2: number };

// Exporta o contorno (aresta externa + furos internos, se houver) da face
// plana clicada como DXF 2D "achatado" no próprio plano da face — ao
// estilo "Exportar face" do Inventor. Retorna null se o ponto clicado não
// corresponder a nenhuma face plana identificável.
export function exportFaceToDxf(
  solid: Solid,
  point: [number, number, number],
  normal: [number, number, number]
): string | null {
  const plane = sketchPlaneFromHit(point, normal);

  let bestDist = Infinity;
  let bestSegments: Segment[] | null = null;

  for (const face of solid.faces) {
    if (face.geomType !== "PLANE") continue;

    const centerVec = face.center;
    const center: [number, number, number] = [centerVec.x, centerVec.y, centerVec.z];
    centerVec.delete();

    const normalVec = face.normalAt(center);
    const faceNormal: [number, number, number] = [normalVec.x, normalVec.y, normalVec.z];
    normalVec.delete();

    const dot = normal[0] * faceNormal[0] + normal[1] * faceNormal[1] + normal[2] * faceNormal[2];
    if (Math.abs(dot) < 0.9) continue;

    const toPoint: [number, number, number] = [
      point[0] - center[0],
      point[1] - center[1],
      point[2] - center[2],
    ];
    const planeDist = Math.abs(
      toPoint[0] * faceNormal[0] + toPoint[1] * faceNormal[1] + toPoint[2] * faceNormal[2]
    );

    if (planeDist > 0.5 || planeDist >= bestDist) continue;

    // Candidata melhor até agora — extrai o contorno JÁ, sem esperar o
    // laço terminar.
    //
    // face.outerWire() e face.innerWires() do replicad chamam this.delete()
    // internamente como efeito colateral (consomem a Face) — era esse o bug
    // real por trás do "This object has been deleted": [face.outerWire(),
    // ...face.innerWires()] chamava outerWire() primeiro, que já apagava
    // `face`, e innerWires() quebrava em seguida na mesma Face morta. Por
    // isso outerWire() sai de um clone descartável e innerWires() usa a
    // face original (que aí sim pode ser consumida, já que não precisamos
    // mais dela depois).
    const segments: Segment[] = [];
    const wires = [face.clone().outerWire(), ...face.innerWires()];
    for (const wire of wires) {
      const { lines } = wire.meshEdges();
      for (let i = 0; i + 5 < lines.length; i += 6) {
        const a = worldToLocalPoint(plane, [lines[i], lines[i + 1], lines[i + 2]]);
        const b = worldToLocalPoint(plane, [lines[i + 3], lines[i + 4], lines[i + 5]]);
        segments.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
      }
    }

    bestDist = planeDist;
    bestSegments = segments;
  }

  if (!bestSegments || bestSegments.length === 0) return null;
  return buildDxfFromSegments(bestSegments);
}

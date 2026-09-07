import type { Face, Solid } from "replicad";

export type AxisResult = {
  origin: [number, number, number];
  direction: [number, number, number];
  // Tipo da face de onde o eixo veio — PLANE = normal de uma face plana,
  // CYLINDRE/CONE = eixo de um furo/ressalto redondo. Opcional só porque
  // AxisResult já existia sem isso; quem não precisa (ferramenta de Eixo
  // do Modelador) ignora o campo.
  geomType?: "PLANE" | "CYLINDRE" | "CONE";
  // Só presente pra CYLINDRE/CONE — raio da face no ponto amostrado (num
  // CONE varia ao longo do eixo, então é só uma referência local ao ponto
  // clicado, não um raio único da feature inteira).
  radius?: number;
};

// Teste "canônico" de ponto-na-face: projeta o ponto clicado na superfície
// subjacente (uvCoordinates), confere se cai dentro do contorno APARADO da
// face (UVBounds — sem isso seria a superfície infinita, não a face real) e
// se reconstruir esse (u,v) devolve um ponto bem perto do original. Mais
// confiável do que casar pelo índice do triângulo do raycast do Three.js
// (sem relação documentada com o id de face do replicad) ou por distância
// de plano (não serve pra superfícies curvas).
function isPointOnFace(face: Face, point: [number, number, number]): boolean {
  const [u, v] = face.uvCoordinates(point);
  const { uMin, uMax, vMin, vMax } = face.UVBounds;
  const uMargin = (uMax - uMin) * 0.02 || 1e-3;
  const vMargin = (vMax - vMin) * 0.02 || 1e-3;
  if (u < uMin - uMargin || u > uMax + uMargin) return false;
  if (v < vMin - vMargin || v > vMax + vMargin) return false;

  // face.pointOnSurface espera u/v NORMALIZADOS em [0,1] relativos ao
  // UVBounds (absoluteU = u*(uMax-uMin)+uMin, ver replicad.js) — já
  // face.uvCoordinates devolve o parâmetro ABSOLUTO. Sem essa normalização
  // aqui, o ponto reconstruído caía bem longe do clicado (ex.: ao ângulo/
  // altura certos, mas escalados pelo tamanho do UVBounds), fazendo esta
  // função devolver false pra praticamente qualquer face real.
  const normalizedU = (u - uMin) / (uMax - uMin || 1);
  const normalizedV = (v - vMin) / (vMax - vMin || 1);
  const reconstructed = face.pointOnSurface(normalizedU, normalizedV);
  const dist = Math.hypot(
    reconstructed.x - point[0],
    reconstructed.y - point[1],
    reconstructed.z - point[2]
  );
  reconstructed.delete();
  return dist < 1;
}

// Numa face cilíndrica/cônica, U é o parâmetro angular e V o parâmetro ao
// longo do eixo (convenção padrão do OpenCascade) — duas amostras no mesmo
// U com V diferente dão uma reta paralela ao eixo. O centroide da face
// (soma/média da área) cai exatamente SOBRE o eixo quando a face é uma
// volta completa (caso normal de um furo cilíndrico neste app), então serve
// de origem sem precisar calcular o centro do círculo à parte.
// Distância de um ponto até a RETA que passa por `origin` na direção
// `direction` (unitária) — usada só pra medir o raio de uma face
// cilíndrica/cônica a partir de um ponto amostrado nela.
function distanceToLine(
  point: [number, number, number],
  origin: [number, number, number],
  direction: [number, number, number]
): number {
  const toPoint: [number, number, number] = [point[0] - origin[0], point[1] - origin[1], point[2] - origin[2]];
  const along = toPoint[0] * direction[0] + toPoint[1] * direction[1] + toPoint[2] * direction[2];
  const closest: [number, number, number] = [
    origin[0] + direction[0] * along,
    origin[1] + direction[1] * along,
    origin[2] + direction[2] * along,
  ];
  return Math.hypot(point[0] - closest[0], point[1] - closest[1], point[2] - closest[2]);
}

function axisFromCurvedFace(face: Face): AxisResult | null {
  const { uMin, uMax, vMin, vMax } = face.UVBounds;
  if (!Number.isFinite(vMin) || !Number.isFinite(vMax) || Math.abs(vMax - vMin) < 1e-6) return null;

  const uMid = (uMin + uMax) / 2;
  const p1 = face.pointOnSurface(uMid, vMin);
  const p2 = face.pointOnSurface(uMid, vMax);
  const direction: [number, number, number] = [p2.x - p1.x, p2.y - p1.y, p2.z - p1.z];
  const samplePoint: [number, number, number] = [p1.x, p1.y, p1.z];
  p1.delete();
  p2.delete();

  const len = Math.hypot(direction[0], direction[1], direction[2]);
  if (len < 1e-6) return null;

  const centerVec = face.center;
  const origin: [number, number, number] = [centerVec.x, centerVec.y, centerVec.z];
  centerVec.delete();

  const unitDirection: [number, number, number] = [direction[0] / len, direction[1] / len, direction[2] / len];
  const radius = distanceToLine(samplePoint, origin, unitDirection);

  return {
    origin,
    direction: unitDirection,
    geomType: face.geomType === "CONE" ? "CONE" : "CYLINDRE",
    radius,
  };
}

function axisFromPlanarFace(face: Face): AxisResult {
  const centerVec = face.center;
  const origin: [number, number, number] = [centerVec.x, centerVec.y, centerVec.z];
  centerVec.delete();

  const normalVec = face.normalAt(origin);
  const direction: [number, number, number] = [normalVec.x, normalVec.y, normalVec.z];
  normalVec.delete();

  return { origin, direction, geomType: "PLANE" };
}

// Acha o eixo "pelo centroide" da face clicada, ao estilo Inventor: numa
// face cilíndrica/cônica (parede de um furo, por exemplo) o eixo segue o
// comprimento dela — é o centro real do furo; numa face plana, sai normal
// a ela passando pelo centroide.
//
// De propósito NÃO chama .delete() nas Faces percorridas (só nos Vector
// temporários, objetos isolados e claramente seguros de descartar) — o
// mesmo cuidado do exportador de face pra DXF, depois de um "This object
// has been deleted" real lá (provável estado interno compartilhado entre
// as Faces de solid.faces). Ação rara (um clique), o vazamento é aceitável.
export function findClickedAxis(solid: Solid, point: [number, number, number]): AxisResult | null {
  for (const face of solid.faces) {
    if (face.geomType !== "PLANE" && face.geomType !== "CYLINDRE" && face.geomType !== "CONE") continue;
    if (!isPointOnFace(face, point)) continue;

    const result = face.geomType === "PLANE" ? axisFromPlanarFace(face) : axisFromCurvedFace(face);
    if (result) return result;
  }

  return null;
}

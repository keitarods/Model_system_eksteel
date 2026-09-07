import type { Solid } from "replicad";
import * as THREE from "three";
import { findClickedAxis } from "@/lib/replicad/axisTools";
import { findClickedCircularEdge } from "@/lib/replicad/edgeTools";
import type { MateFrame } from "./types";

// Vetor mundial usado como referência de "xDir" ao construir um MateFrame —
// não existe convenção prévia de xDir de face no app (SketchPlane sempre
// recebe o xDir de quem já escolheu o plano, nunca deriva um sozinho), e
// pra restrição de montagem o valor absoluto de xDir não importa (só serve
// de referência pro ângulo 0 entre duas peças, igual o Inventor também
// escolhe um zero arbitrário na 1ª vez que duas faces se encostam) — só
// precisa ser DETERMINÍSTICO pro mesmo clique sempre dar o mesmo frame.
const WORLD_X = new THREE.Vector3(1, 0, 0);
const WORLD_Y = new THREE.Vector3(0, 1, 0);

function deriveXDir(normal: [number, number, number]): [number, number, number] {
  const n = new THREE.Vector3(...normal).normalize();
  // Gram-Schmidt contra X mundial, caindo pra Y se a normal for quase
  // paralela a X (produto vetorial quase nulo dava um xDir instável/quase
  // zero nesse caso).
  const reference = Math.abs(n.dot(WORLD_X)) > 0.9 ? WORLD_Y : WORLD_X;
  const xDir = reference.clone().sub(n.clone().multiplyScalar(n.dot(reference))).normalize();
  return [xDir.x, xDir.y, xDir.z];
}

// Constrói o MateFrame (em espaço LOCAL do sólido, isto é, coordenadas de
// antes de aplicar o placement da instância — a mesma convenção do sólido
// reconstruído por rebuildModel, que nunca conhece a posição da instância
// na montagem) a partir de um ponto clicado no sólido, ao estilo Inventor:
// reconhece automaticamente o tipo de geometria clicada e monta o quadro
// de referência apropriado —
//   1. Aresta CIRCULAR perto do clique (rebordo de um furo/eixo redondo) —
//      testada primeiro porque é um alvo fino (uma linha), fácil de "perder"
//      se testasse só depois de já ter achado uma face; dá o centro/raio/
//      plano do círculo, pronta pra "Inserir"/Concêntrico.
//   2. Senão, a FACE clicada (findClickedAxis, já usado pelas ferramentas
//      de Eixo do Modelador): plana -> normal da face (Encaixar/Encostar);
//      cilíndrica/cônica -> eixo do furo/ressalto (Inserir).
export function frameFromFaceClick(solid: Solid, point: [number, number, number]): MateFrame | null {
  const circularEdge = findClickedCircularEdge(solid, point);
  if (circularEdge) {
    return {
      origin: circularEdge.origin,
      normal: circularEdge.normal,
      xDir: deriveXDir(circularEdge.normal),
      kind: "cylindrical",
      radius: circularEdge.radius,
    };
  }

  const axis = findClickedAxis(solid, point);
  if (!axis) return null;

  const isCurved = axis.geomType === "CYLINDRE" || axis.geomType === "CONE";
  return {
    origin: axis.origin,
    normal: axis.direction,
    xDir: deriveXDir(axis.direction),
    kind: isCurved ? "cylindrical" : "planar",
    radius: isCurved ? axis.radius : undefined,
  };
}

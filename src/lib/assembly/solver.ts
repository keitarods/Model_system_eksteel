import * as THREE from "three";
import type { AssemblyConstraint, ComponentInstance, ComponentPlacement, MateFrame } from "./types";

// Solver de restrições da montagem: mínimos quadrados não-linear
// (Levenberg-Marquardt amortecido, Jacobiano numérico por diferenças
// finitas) sobre os 6 graus de liberdade (posição + rotação, como vetor
// eixo-ângulo) de cada componente NÃO fixo que participa de pelo menos uma
// restrição. Resolve todas as restrições de todos os componentes em
// conjunto — permite empilhar 2+ restrições no mesmo componente (ex. 3
// faces encostadas travam ele totalmente) sem que uma "vença" da outra.
//
// Componentes fixos (`grounded`) e componentes sem nenhuma restrição
// mantêm sua `placementSeed` (posição arrastada à mão) intocada — só
// entram como incógnita os que o usuário efetivamente amarrou a outra
// peça.

export type SolveResult = {
  placements: Record<string, ComponentPlacement>;
  // Maior resíduo (mm) entre as restrições depois de resolver — perto de 0
  // é uma montagem bem resolvida; alto indica restrições conflitantes/
  // impossíveis de satisfazer juntas (equivalente ao aviso de
  // sobre-restrição do Inventor).
  maxResidual: number;
  unsatisfiedConstraintIds: string[];
};

// Normais/xDir são vetores unitários (erro de ordem 0-2); posições são em
// mm (erro tipicamente de dezenas a centenas). Sem essa escala, o solver
// praticamente ignoraria erros de orientação perto de erros de posição bem
// maiores — não é uma unidade "de verdade", só o fator que dá aos dois
// tipos de resíduo uma magnitude comparável.
const ANGULAR_RESIDUAL_SCALE = 50;
const REGULARIZATION_WEIGHT = 1e-4;
const CONVERGENCE_TOLERANCE = 1e-3;
const MAX_ITERATIONS = 60;
const FINITE_DIFF_EPS = 1e-5;

function axisAngleToQuaternion(v: THREE.Vector3): THREE.Quaternion {
  const angle = v.length();
  if (angle < 1e-9) return new THREE.Quaternion();
  return new THREE.Quaternion().setFromAxisAngle(v.clone().normalize(), angle);
}

function quaternionToAxisAngle(q: [number, number, number, number]): THREE.Vector3 {
  const quat = new THREE.Quaternion(q[0], q[1], q[2], q[3]).normalize();
  const angle = 2 * Math.acos(Math.min(1, Math.max(-1, quat.w)));
  if (angle < 1e-9) return new THREE.Vector3(0, 0, 0);
  const s = Math.sqrt(1 - quat.w * quat.w);
  const axis =
    s < 1e-9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(quat.x / s, quat.y / s, quat.z / s);
  return axis.multiplyScalar(angle);
}

function placementFromParams(position: THREE.Vector3, rotVec: THREE.Vector3): ComponentPlacement {
  const q = axisAngleToQuaternion(rotVec);
  return { position: [position.x, position.y, position.z], quaternion: [q.x, q.y, q.z, q.w] };
}

function worldFrame(placement: ComponentPlacement, frame: MateFrame) {
  const q = new THREE.Quaternion(...placement.quaternion);
  const pos = new THREE.Vector3(...placement.position);
  return {
    origin: new THREE.Vector3(...frame.origin).applyQuaternion(q).add(pos),
    normal: new THREE.Vector3(...frame.normal).applyQuaternion(q).normalize(),
    xDir: new THREE.Vector3(...frame.xDir).applyQuaternion(q).normalize(),
  };
}

// Resíduo de uma única restrição, dadas as posições MUNDIAIS atuais dos
// dois quadros — reaproveitado tanto durante a otimização (função de
// custo) quanto depois, pra medir quão bem cada restrição ficou satisfeita
// no resultado final.
//
// Ao estilo Inventor: uma restrição NUNCA trava os 6 graus de liberdade
// sozinha, só o que faz sentido pro tipo de geometria — o resto fica livre
// pra arrastar (ver draggableInstanceId em AssemblyWorkspace.tsx). A
// normal/eixo dos dois quadros SEMPRE se alinha (senão a restrição não
// significaria nada), mas a posição AO LONGO dela (`lockDistance`) e a
// rotação EM TORNO dela (`lockAngle`) só entram no resíduo se o usuário
// pedir explicitamente — senão ficam de fora, e o componente desliza/gira
// livremente nesse grau enquanto o resto da restrição continua satisfeita.
// Ausente (arquivo salvo antes desses campos existirem) = true, pra manter
// o comportamento rígido de antes em montagens já salvas.
function constraintResidual(
  constraint: AssemblyConstraint,
  placementA: ComponentPlacement,
  placementB: ComponentPlacement
): number[] {
  const a = worldFrame(placementA, constraint.frameA);
  const b = worldFrame(placementB, constraint.frameB);
  const lockDistance = constraint.lockDistance ?? true;
  const lockAngle = constraint.lockAngle ?? true;

  const targetNormalB = constraint.flip ? a.normal.clone() : a.normal.clone().negate();
  const residualNormal = b.normal.clone().sub(targetNormalB).multiplyScalar(ANGULAR_RESIDUAL_SCALE);

  const delta = b.origin.clone().sub(a.origin);
  const alongNormal = delta.dot(a.normal);

  const isCylindrical = constraint.frameA.kind === "cylindrical" && constraint.frameB.kind === "cylindrical";
  const residual: number[] = [];

  if (isCylindrical) {
    // Concêntrico: a posição PERPENDICULAR ao eixo sempre alinha (é o que
    // faz os dois eixos coincidirem) — só a posição AO LONGO do eixo
    // (deslizar pra dentro/fora) é opcional.
    const perp = delta.clone().sub(a.normal.clone().multiplyScalar(alongNormal));
    residual.push(perp.x, perp.y, perp.z);
    if (lockDistance) residual.push(alongNormal - constraint.offset);
  } else {
    // Mate/Encaixar: a distância ao longo da normal É a restrição — sem
    // ela travada não sobraria nada prendendo as peças (só normais
    // paralelas, sem as faces se tocando), então conta mesmo sem
    // lockDistance explícito.
    residual.push(alongNormal - constraint.offset);
  }

  residual.push(residualNormal.x, residualNormal.y, residualNormal.z);

  if (lockAngle) {
    const angleRad = (constraint.angle * Math.PI) / 180;
    const targetXDir = a.xDir.clone().applyAxisAngle(a.normal, angleRad);
    const residualXDir = b.xDir.clone().sub(targetXDir).multiplyScalar(ANGULAR_RESIDUAL_SCALE);
    residual.push(residualXDir.x, residualXDir.y, residualXDir.z);
  }

  return residual;
}

// --- Álgebra linear mínima (só o suficiente pra Levenberg-Marquardt numa
// escala de dezenas de componentes — sem trazer uma lib externa à toa). ---

function transposeTimesSelf(J: number[][]): number[][] {
  const n = J[0]?.length ?? 0;
  const result = Array.from({ length: n }, () => new Array(n).fill(0));
  for (const row of J) {
    for (let i = 0; i < n; i++) {
      if (row[i] === 0) continue;
      for (let j = 0; j < n; j++) result[i][j] += row[i] * row[j];
    }
  }
  return result;
}

function transposeTimesVector(J: number[][], r: number[]): number[] {
  const n = J[0]?.length ?? 0;
  const result = new Array(n).fill(0);
  for (let row = 0; row < J.length; row++) {
    const ri = r[row];
    if (ri === 0) continue;
    for (let j = 0; j < n; j++) result[j] += J[row][j] * ri;
  }
  return result;
}

// Eliminação de Gauss com pivô parcial — resolve A·x = b. Devolve null se A
// ficar singular demais pra inverter com segurança (LM aumenta o
// amortecimento e tenta de novo nesse caso).
function solveLinearSystem(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[pivotRow][col])) pivotRow = row;
    }
    if (Math.abs(M[pivotRow][col]) < 1e-12) return null;
    [M[col], M[pivotRow]] = [M[pivotRow], M[col]];

    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = M[row][col] / M[col][col];
      for (let k = col; k <= n; k++) M[row][k] -= factor * M[col][k];
    }
  }

  return M.map((row, i) => row[n] / row[i]);
}

function sumSquares(values: number[]): number {
  return values.reduce((acc, v) => acc + v * v, 0);
}

export function solveAssembly(instances: ComponentInstance[], constraints: AssemblyConstraint[]): SolveResult {
  const byId = new Map(instances.map((i) => [i.id, i]));
  const activeConstraints = constraints.filter((c) => {
    const a = byId.get(c.instanceA);
    const b = byId.get(c.instanceB);
    return a && b && !a.suppressed && !b.suppressed;
  });

  const freeIds = instances
    .filter(
      (i) =>
        !i.grounded &&
        !i.suppressed &&
        activeConstraints.some((c) => c.instanceA === i.id || c.instanceB === i.id)
    )
    .map((i) => i.id);
  const freeIndex = new Map(freeIds.map((id, i) => [id, i]));

  const placements: Record<string, ComponentPlacement> = {};
  for (const instance of instances) {
    if (!freeIndex.has(instance.id)) placements[instance.id] = instance.placementSeed;
  }

  if (freeIds.length === 0) {
    return { placements, maxResidual: 0, unsatisfiedConstraintIds: [] };
  }

  const seedParams = freeIds.flatMap((id) => {
    const seed = byId.get(id)!.placementSeed;
    const rotVec = quaternionToAxisAngle(seed.quaternion);
    return [seed.position[0], seed.position[1], seed.position[2], rotVec.x, rotVec.y, rotVec.z];
  });

  function placementFor(id: string, params: number[]): ComponentPlacement {
    const idx = freeIndex.get(id);
    if (idx == null) return placements[id];
    const o = idx * 6;
    return placementFromParams(
      new THREE.Vector3(params[o], params[o + 1], params[o + 2]),
      new THREE.Vector3(params[o + 3], params[o + 4], params[o + 5])
    );
  }

  function buildResiduals(params: number[]): number[] {
    const residuals: number[] = [];
    for (const constraint of activeConstraints) {
      residuals.push(
        ...constraintResidual(
          constraint,
          placementFor(constraint.instanceA, params),
          placementFor(constraint.instanceB, params)
        )
      );
    }
    for (let i = 0; i < params.length; i++) {
      residuals.push(REGULARIZATION_WEIGHT * (params[i] - seedParams[i]));
    }
    return residuals;
  }

  let params = [...seedParams];
  let residual = buildResiduals(params);
  let cost = sumSquares(residual);
  let lambda = 1e-3;

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    if (Math.sqrt(cost) < CONVERGENCE_TOLERANCE) break;

    // Jacobiano numérico (diferença central) — uma coluna por parâmetro.
    const jacobianColumns: number[][] = [];
    for (let j = 0; j < params.length; j++) {
      const plus = [...params];
      const minus = [...params];
      plus[j] += FINITE_DIFF_EPS;
      minus[j] -= FINITE_DIFF_EPS;
      const rPlus = buildResiduals(plus);
      const rMinus = buildResiduals(minus);
      jacobianColumns.push(rPlus.map((v, k) => (v - rMinus[k]) / (2 * FINITE_DIFF_EPS)));
    }
    // jacobianColumns[j][row] -> transpor pra J[row][col] (formato que o
    // resto da álgebra abaixo espera).
    const rows = residual.length;
    const J: number[][] = Array.from({ length: rows }, (_, row) =>
      jacobianColumns.map((col) => col[row])
    );

    const JT_J = transposeTimesSelf(J);
    const JT_r = transposeTimesVector(J, residual);

    let accepted = false;
    for (let attempt = 0; attempt < 8 && !accepted; attempt++) {
      const damped = JT_J.map((row, i) => row.map((v, j) => (i === j ? v + lambda * Math.max(v, 1e-9) : v)));
      const delta = solveLinearSystem(
        damped,
        JT_r.map((v) => -v)
      );
      if (!delta) {
        lambda *= 10;
        continue;
      }

      const candidate = params.map((v, i) => v + delta[i]);
      const candidateResidual = buildResiduals(candidate);
      const candidateCost = sumSquares(candidateResidual);

      if (candidateCost < cost) {
        params = candidate;
        residual = candidateResidual;
        cost = candidateCost;
        lambda = Math.max(lambda / 3, 1e-9);
        accepted = true;
      } else {
        lambda *= 5;
      }
    }

    if (!accepted) break; // não achou passo que melhore — já convergiu ou empacou
  }

  for (const id of freeIds) placements[id] = placementFor(id, params);

  let maxResidual = 0;
  const unsatisfiedConstraintIds: string[] = [];
  for (const constraint of activeConstraints) {
    const r = constraintResidual(
      constraint,
      placements[constraint.instanceA],
      placements[constraint.instanceB]
    );
    const norm = Math.sqrt(sumSquares(r)) / ANGULAR_RESIDUAL_SCALE;
    if (norm > maxResidual) maxResidual = norm;
    if (norm > 0.5) unsatisfiedConstraintIds.push(constraint.id);
  }

  return { placements, maxResidual, unsatisfiedConstraintIds };
}

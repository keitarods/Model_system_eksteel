import * as THREE from "three";
import { planeYDir } from "@/lib/replicad/plane";
import type { SketchPlane } from "@/lib/sketch/types";

// Converte a base local do plano (xDir/yDir/normal) numa rotação Three.js —
// usado por qualquer mesh que precise ficar "deitado" sobre o plano do
// sketch (destaque do plano ativo, plano interativo de desenho, planos
// padrão clicáveis ao criar um esboço).
export function planeBasisQuaternion(plane: SketchPlane): THREE.Quaternion {
  const yDir = planeYDir(plane);
  const basis = new THREE.Matrix4().makeBasis(
    new THREE.Vector3(...plane.xDir),
    new THREE.Vector3(...yDir),
    new THREE.Vector3(...plane.normal)
  );
  return new THREE.Quaternion().setFromRotationMatrix(basis);
}

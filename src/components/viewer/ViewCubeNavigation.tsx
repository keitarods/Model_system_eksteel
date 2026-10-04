"use client";
import {useEffect,useRef} from 'react';
import {useThree,type ThreeEvent} from '@react-three/fiber';
import {GizmoViewcube} from '@react-three/drei';
import * as THREE from 'three';
import {applyCameraPose,orientCamera,cubeViewDirection,type NavigationControls} from './cameraNavigation';
import {IconRotateCW,IconRotateCCW} from '@/components/icons/ToolIcons';

export type CameraApi = {
  camera: THREE.Camera;
  controls: NavigationControls | null;
  size: { width: number; height: number };
};

export function CameraApiCapture({ apiRef }: { apiRef: React.MutableRefObject<CameraApi | null> }) {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as CameraApi["controls"];
  const size = useThree((state) => state.size);

  useEffect(() => {
    apiRef.current = { camera, controls, size };
  }, [apiRef, camera, controls, size]);

  return null;
}

// Gira a câmera em torno de target por deltaAzimuth/deltaPolar (radianos),
// igual o arrastar do OrbitControls — mas reimplementado à mão porque o
// ViewCube fica no Hud (câmera separada) e por isso não pode simplesmente
// deixar o OrbitControls "de verdade" processar o arrasto. setFromUnitVectors
// alinha camera.up com +Y antes da conta esférica e desalinha depois — é o
// mesmo truque que o OrbitControls usa por baixo dos panos pra funcionar
// com qualquer "up" (aqui é Z, não o Y padrão do three.js); sem isso a
// órbita ficaria girando em torno do eixo errado.
function orbitCameraAround(camera: THREE.Camera, target: THREE.Vector3, deltaAzimuth: number, deltaPolar: number) {
  const quat = new THREE.Quaternion().setFromUnitVectors(camera.up, new THREE.Vector3(0, 1, 0));
  const quatInverse = quat.clone().invert();

  const offset = camera.position.clone().sub(target).applyQuaternion(quat);
  const spherical = new THREE.Spherical().setFromVector3(offset);

  spherical.theta -= deltaAzimuth;
  spherical.phi = Math.max(0.001, Math.min(Math.PI - 0.001, spherical.phi - deltaPolar));

  offset.setFromSpherical(spherical).applyQuaternion(quatInverse);
  camera.position.copy(target).add(offset);
  camera.lookAt(target);
}

// Sensibilidade do arrastar no ViewCube — radianos de órbita por "altura de
// tela" arrastada, mesma ordem de grandeza do rotateSpeed padrão do
// OrbitControls (2π por altura da tela).
const CUBE_DRAG_SENSITIVITY = Math.PI;

// Gira a IMAGEM em si (roll 2D em torno do próprio eixo de visão), não
// reorienta a câmera pra outra vista 3D — ao estilo dos 2 botões curvos do
// ViewCube do Inventor. Roda "up" em torno da direção de visão (câmera →
// alvo) por deltaAngle e reaplica lookAt: a posição da câmera e o que ela
// mira não mudam, só o "lado pra cima" gira, girando o enquadramento
// inteiro na tela.
function rollViewStep(api: CameraApi | null, target: [number, number, number], deltaAngle: number) {
  if (!api) return;
  const targetVec = api.controls?.target.clone() ?? new THREE.Vector3(...target);
  const forward = targetVec.clone().sub(api.camera.position).normalize();
  if (forward.lengthSq() < 1e-9) return;
  const up = api.camera.up.clone().applyAxisAngle(forward, deltaAngle);
  applyCameraPose(api.camera, api.controls, api.camera.position, targetVec, up);
}

// 2 setas curvas de giro (sentido horário/anti-horário) coladas embaixo do
// ViewCube, igual o Inventor — giro 2D de 90° por clique, não uma
// reorientação 3D pra outra vista (essa já existe: clicar face/aresta/canto
// do próprio cubo). Vive FORA do Canvas (HTML normal sobreposto, não WebGL)
// porque o ViewCube mora num Hud com câmera virtual própria (ver comentário
// de CameraApiCapture); um <div> ancorado nas mesmas coordenadas de
// alignment/margin do GizmoHelper (top-right, 70/70) é bem mais simples que
// desenhar isso dentro do Hud. cameraApiRef é lido direto (mutação de
// objetos three.js de verdade, não estado React), mesma técnica já usada
// pelo arrastar do cubo.
export function ViewCubeRotationArrows({
  apiRef,
  orbitTarget,
}: {
  apiRef: React.MutableRefObject<CameraApi | null>;
  orbitTarget: [number, number, number];
}) {
  const arrowClass =
    "pointer-events-auto absolute flex h-6 w-6 items-center justify-center rounded-full bg-white/90 text-primary-700 shadow hover:bg-primary-100 hover:text-primary-900";

  return (
    <div className="pointer-events-none absolute" style={{ top: 70, right: 70, width: 0, height: 0 }}>
      <button
        type="button"
        title="Girar vista 90° (anti-horário)"
        onClick={() => rollViewStep(apiRef.current, orbitTarget, Math.PI / 2)}
        className={arrowClass}
        style={{ left: -46, top: 34 }}
      >
        <IconRotateCCW />
      </button>
      <button
        type="button"
        title="Girar vista 90° (horário)"
        onClick={() => rollViewStep(apiRef.current, orbitTarget, -Math.PI / 2)}
        className={arrowClass}
        style={{ left: 10, top: 34 }}
      >
        <IconRotateCW />
      </button>
    </div>
  );
}

// Cobre o ViewCube inteiro (não tem geometria própria — um <group> sem
// malha não é alvo de raycast, mas ainda recebe eventos que borbulham dos
// filhos, e nem FaceCube nem EdgeCube do drei chamam stopPropagation() no
// pointerDown, só no click) — ao pressionar e arrastar (em vez de só
// clicar), desliga o OrbitControls principal (senão os dois competem pelo
// mesmo gesto nativo do navegador) e orbita a câmera à mão; soltar
// reativa o OrbitControls. Cliques aplicam uma orientação estável; arrastos
// não disparam a troca de vista ao soltar. O tween padrão do GizmoHelper
// não é usado: ele restaura o up inicial e pode deslocar vistas Z-up.
export function ViewCubeOrbitCatcher({ apiRef }: {
  apiRef: React.MutableRefObject<CameraApi | null>;
}) {
  const dragged = useRef(false);
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);

  function handlePointerDown(event: ThreeEvent<PointerEvent>) {
    if (event.nativeEvent.button !== 0) return;
    event.stopPropagation();
    cleanup.current?.();
    const api = apiRef.current;
    if (!api) return;
    const wasEnabled = api.controls?.enabled;
    const target = api.controls?.target.clone() ?? new THREE.Vector3();
    applyCameraPose(api.camera, api.controls, api.camera.position, target, api.camera.up);
    if (api.controls) api.controls.enabled = false;
    dragged.current = false;
    const { clientX: startX, clientY: startY, pointerId } = event.nativeEvent;
    let lastX = startX;
    let lastY = startY;
    function handleMove(e: PointerEvent) {
      if (e.pointerId !== pointerId) return;
      if (!dragged.current && Math.hypot(e.clientX - startX, e.clientY - startY) < 4) return;
      dragged.current = true;
      const h = api!.size.height || 1;
      orbitCameraAround(api!.camera, target,
        ((e.clientX - lastX) / h) * CUBE_DRAG_SENSITIVITY,
        ((e.clientY - lastY) / h) * CUBE_DRAG_SENSITIVITY);
      lastX = e.clientX;
      lastY = e.clientY;
      api!.controls?.update();
    }
    function finish() {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleCancel);
      window.removeEventListener("blur", handleCancel);
      if (api!.controls) api!.controls.enabled = wasEnabled ?? true;
      cleanup.current = null;
    }
    function handleUp(e: PointerEvent) { if (e.pointerId === pointerId) finish(); }
    function handleCancel() { dragged.current = true; finish(); }
    cleanup.current = finish;
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleCancel);
    window.addEventListener("blur", handleCancel);
  }

  return <group onPointerDown={handlePointerDown}>
    <GizmoViewcube
      faces={["DIREITA", "ESQUERDA", "TRÁS", "FRENTE", "CIMA", "BAIXO"]}
      color="#eceff1" hoverColor="#546E7A" textColor="#263238" strokeColor="#90a4ae"
      onClick={(event) => {
        event.stopPropagation();
        const api = apiRef.current;
        if (!api || dragged.current) return null;
        const direction = cubeViewDirection(event.object.position, event.face?.normal);
        if (direction) orientCamera(api.camera, api.controls, direction);
        return null;
      }}
    />
  </group>;
}

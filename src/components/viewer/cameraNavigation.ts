import { Camera, Vector3 } from "three";

export type NavigationControls = {
  target: Vector3;
  enabled: boolean;
  enableDamping: boolean;
  update: () => unknown;
};

/** Apply camera and orbit target together, discarding residual drag inertia.
 * A command must remain stable when OrbitControls updates on the next frame. */
export function applyCameraPose(
  camera: Camera,
  controls: NavigationControls | null,
  position: Vector3,
  target: Vector3,
  up: Vector3,
) {
  // Clone before update: callers can pass controls.target/camera.position.
  const nextPosition = position.clone();
  const nextTarget = target.clone();
  const nextUp = up.clone().normalize();
  const damping = controls?.enableDamping;
  if (controls) {
    controls.enableDamping = false;
    controls.update();
    controls.target.copy(nextTarget);
  }
  camera.up.copy(nextUp);
  camera.position.copy(nextPosition);
  camera.lookAt(nextTarget);
  controls?.update();
  if (controls) controls.enableDamping = damping!;
  camera.updateMatrixWorld();
}

/** Z-up views, with Y-up at the poles to avoid an undefined lookAt/roll. */
export function orientCamera(camera: Camera, controls: NavigationControls | null, direction: Vector3) {
  if (direction.lengthSq() < 1e-12) return;
  const target = controls?.target.clone() ?? new Vector3();
  const distance = Math.max(camera.position.distanceTo(target), 5);
  const normal = direction.clone().normalize();
  const up = Math.abs(normal.z) > 0.999 ? new Vector3(0, 1, 0) : new Vector3(0, 0, 1);
  applyCameraPose(camera, controls, target.clone().addScaledVector(normal, distance), target, up);
}

/** Cube faces use their local normal; edge/corner hit boxes use their center. */
export function cubeViewDirection(position: Vector3, normal: Vector3 | undefined): Vector3 | null {
  const direction = position.lengthSq() > 1e-12 ? position : normal;
  return direction?.clone().normalize() ?? null;
}

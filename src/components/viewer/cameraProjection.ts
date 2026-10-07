import { OrthographicCamera, PerspectiveCamera, Vector3 } from "three";

/** Preserve orientation and apparent size at the orbit target when switching projection. */
export function cameraWithProjection(camera: OrthographicCamera | PerspectiveCamera, target: Vector3, size: {width: number; height: number}, mode: "orthographic" | "perspective") {
  const distance = Math.max(camera.position.distanceTo(target), 0.01);
  const height = camera instanceof OrthographicCamera
  ? (camera.top - camera.bottom) / camera.zoom
  : 2 * distance * Math.tan((camera as PerspectiveCamera).getEffectiveFOV() * Math.PI / 360);
  const next = mode === "orthographic"
  ? new OrthographicCamera(-size.width / 2, size.width / 2, size.height / 2, -size.height / 2, camera.near, camera.far)
  : new PerspectiveCamera(45, size.width / size.height, camera.near, camera.far);
  next.position.copy(camera.position);
  next.up.copy(camera.up);
  next.quaternion.copy(camera.quaternion);
  if (next instanceof OrthographicCamera) next.zoom = size.height / height;
  else next.position.copy(target).add(camera.position.clone().sub(target).normalize().multiplyScalar(height / (2 * Math.tan(Math.PI / 8))));
  next.updateProjectionMatrix();
  next.updateMatrixWorld();
  return next;
}

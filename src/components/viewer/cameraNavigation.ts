import { Box3, Camera, OrthographicCamera, PerspectiveCamera, Vector3 } from "three";

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

/** Align to a sketch plane and back out to fit the part, never zooming in. */
export function focusSketchPlane(camera: Camera, controls: NavigationControls | null, origin: Vector3, normal: Vector3, up: Vector3, vertices?: ArrayLike<number>) {
  const previousTarget = controls?.target.clone() ?? new Vector3();
  let distance = camera.position.distanceTo(previousTarget);
  const direction = normal.clone().normalize();
  let target = previousTarget.clone().addScaledVector(direction, -previousTarget.clone().sub(origin).dot(direction));
  if (vertices && vertices.length >= 3) {
    const bounds = new Box3();
    const point = new Vector3();
    for (let i = 0; i + 2 < vertices.length; i += 3) {
      point.set(vertices[i], vertices[i + 1], vertices[i + 2]);
      if (point.toArray().every(Number.isFinite)) bounds.expandByPoint(point);
    }
    if (!bounds.isEmpty()) {
      const center = bounds.getCenter(new Vector3());
      const radius = Math.max(bounds.getSize(new Vector3()).length() / 2, 0.01);
      const margin = 1.25;
      const depth = center.clone().sub(origin).dot(direction);
      target = center.clone().addScaledVector(direction, -depth);
      if (camera instanceof OrthographicCamera) {
        // Moving an orthographic camera alone does not change apparent size.
        const fitZoom = Math.min(camera.right - camera.left, camera.top - camera.bottom) / (2 * radius * margin);
        camera.zoom = Math.min(camera.zoom, fitZoom);
        distance = Math.max(distance, depth + 2 * radius * margin, 5);
      } else if (camera instanceof PerspectiveCamera) {
        const vertical = camera.getEffectiveFOV() * Math.PI / 360;
        const horizontal = Math.atan(Math.tan(vertical) * camera.aspect);
        distance = Math.max(distance, depth + radius * margin / Math.sin(Math.min(vertical, horizontal)), 5);
      }
      if (camera instanceof OrthographicCamera || camera instanceof PerspectiveCamera) {
        camera.far = Math.max(camera.far, distance - depth + radius * 2);
        camera.updateProjectionMatrix();
      }
    }
  }
  applyCameraPose(camera, controls, target.clone().addScaledVector(direction, Math.max(distance, 1e-6)), target, up);
  return target;
}

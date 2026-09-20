import type { Point } from "./types";

/** Vertices from a snapped center and circumradius handle. Never snap individual
 * vertices: doing so would destroy equal sides. O(sides), bounded for interaction. */
export function regularPolygon(center: Point, vertex: Point, sides: number): Point[] {
  if (!Number.isInteger(sides) || sides < 3 || sides > 128 ||
      ![center.x, center.y, vertex.x, vertex.y].every(Number.isFinite)) return [];
  const radius = Math.hypot(vertex.x - center.x, vertex.y - center.y);
  if (radius < 1e-6) return [];
  const angle = Math.atan2(vertex.y - center.y, vertex.x - center.x);
  return Array.from({ length: sides }, (_, i) => ({
    x: center.x + radius * Math.cos(angle + i * 2 * Math.PI / sides),
    y: center.y + radius * Math.sin(angle + i * 2 * Math.PI / sides),
  }));
}

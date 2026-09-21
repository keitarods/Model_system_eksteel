import type { Feature } from './types';
import type { SketchPlane } from '@/lib/sketch/types';

/** Preserve local sketch geometry, dimensions and constraints when changing support. */
export function redefineSketchPlane(features: Feature[], id: string, plane: SketchPlane, options: { preserveWorldPosition?: boolean } = {}): Feature[] {
  if (!features.some(f => f.id === id && f.type === 'sketch')) throw new Error('Esboço não encontrado.');
  const { origin, normal, xDir } = plane;
  const cross = [normal[1]*xDir[2]-normal[2]*xDir[1], normal[2]*xDir[0]-normal[0]*xDir[2], normal[0]*xDir[1]-normal[1]*xDir[0]];
  if (![...origin,...normal,...xDir].every(Number.isFinite) || Math.hypot(...cross) < 1e-8) throw new Error('Plano inválido para o esboço.');
  if (options.preserveWorldPosition) {
    const sketch = features.find(f => f.id === id && f.type === 'sketch')!;
    if (sketch.type !== 'sketch') throw new Error('Esboço não encontrado.');
    const previous = sketch.plane;
    const normalLength = Math.hypot(...normal);
    const previousLength = Math.hypot(...previous.normal);
    const alignment = Math.abs(normal.reduce((sum, v, i) => sum + v * previous.normal[i], 0) / (normalLength * previousLength));
    const offset = Math.abs(origin.reduce((sum, v, i) => sum + (v - previous.origin[i]) * normal[i], 0) / normalLength);
    if (!Number.isFinite(alignment) || Math.abs(alignment - 1) > 1e-10 || offset > 1e-5) {
      throw new Error('O novo plano não é coplanar ao esboço. Para manter as linhas no lugar, escolha uma face no mesmo plano. Desmarque “Manter posição” somente se desejar mover o esboço.');
    }
    // Keep the local frame too: avoids changing dimensions, axis locks, arc
    // orientation or the origin-point reference just because the click moved.
    plane = previous;
  }
  return features.map(f => f.id === id && f.type === 'sketch' ? { ...f, plane: { origin: [...plane.origin], normal: [...plane.normal], xDir: [...plane.xDir] } } : f);
}

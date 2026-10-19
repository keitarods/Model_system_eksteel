import type { Solid } from 'replicad';
import type { Feature } from '@/lib/features/types';

/** One-use ownership transfer from import validation to the viewport.
 * Only the exact feature-array identity can consume the prepared geometry. */
export function createModelHandoff<T extends { delete(): void }>() {
  let pending: { features: Feature[]; model: T } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function clear() {
    if (timer) clearTimeout(timer);
    timer = undefined;
    const previous = pending;
    pending = null;
    previous?.model.delete();
  }
  return {
    clear,
    put(features: Feature[], model: T) {
      clear();
      pending = { features, model };
      // A closed workspace or abandoned render must not retain native geometry.
      timer = setTimeout(clear, 30000);
    },
    take(features: Feature[], flatten = false): T | null {
      if (!pending) return null;
      if (flatten || pending.features !== features) { clear(); return null; }
      const model = pending.model;
      pending = null;
      if (timer) clearTimeout(timer);
      timer = undefined;
      return model;
    },
  };
}

export const preparedImportModel = createModelHandoff<Solid>();

import { create } from "zustand";
import type { AssemblyConstraint, ComponentInstance } from "./types";

type AssemblyState = {
  instances: ComponentInstance[];
  constraints: AssemblyConstraint[];
  addInstance: (instance: ComponentInstance) => void;
  updateInstance: (id: string, patch: Partial<ComponentInstance>) => void;
  removeInstance: (id: string) => void;
  addConstraint: (constraint: AssemblyConstraint) => void;
  updateConstraint: (id: string, constraint: AssemblyConstraint) => void;
  removeConstraint: (id: string) => void;
  clear: () => void;
  loadAssembly: (doc: { instances: ComponentInstance[]; constraints: AssemblyConstraint[] }) => void;
};

// Mesmo estilo de useFeatureStore: só os dados persistentes/serializáveis
// da montagem (instâncias + restrições). Sólidos reconstruídos, malhas e
// posições resolvidas pelo solver são estado DERIVADO, calculado por
// efeitos no AssemblyWorkspace (React state ali, não nesta store) — mesmo
// padrão de `mesh`/`edgeLines` no ModeladorWorkspace a partir de
// `useFeatureStore.features`.
export const useAssemblyStore = create<AssemblyState>((set) => ({
  instances: [],
  constraints: [],
  addInstance: (instance) => set((s) => ({ instances: [...s.instances, instance] })),
  updateInstance: (id, patch) =>
    set((s) => ({
      instances: s.instances.map((i) => (i.id === id ? { ...i, ...patch } : i)),
    })),
  removeInstance: (id) =>
    set((s) => ({
      instances: s.instances.filter((i) => i.id !== id),
      // Restrições que dependiam do componente removido não fazem mais
      // sentido — remove junto, senão o solver ficaria referenciando uma
      // instância inexistente.
      constraints: s.constraints.filter((c) => c.instanceA !== id && c.instanceB !== id),
    })),
  addConstraint: (constraint) => set((s) => ({ constraints: [...s.constraints, constraint] })),
  updateConstraint: (id, constraint) =>
    set((s) => ({ constraints: s.constraints.map((c) => (c.id === id ? constraint : c)) })),
  removeConstraint: (id) => set((s) => ({ constraints: s.constraints.filter((c) => c.id !== id) })),
  clear: () => set({ instances: [], constraints: [] }),
  loadAssembly: (doc) => set({ instances: doc.instances, constraints: doc.constraints }),
}));

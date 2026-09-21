import { create } from "zustand";
import type { Feature } from "./types";

type FeatureState = {
  features: Feature[];
  addFeature: (feature: Feature) => void;
  updateFeature: (id: string, feature: Feature) => void;
  removeFeature: (id: string) => void;
  clear: () => void;
};

// Histórico de operações (feature tree simplificada): cada item é reaplicado
// em ordem por rebuildModel sempre que a lista muda — sem parametrização
// completa, mas editável (dá pra remover uma operação e ver o resultado).
export const useFeatureStore = create<FeatureState>((set) => ({
  features: [],
  addFeature: (feature) =>
    set((s) => ({ features: [...s.features, feature] })),
  updateFeature: (id, feature) =>
    set((s) => ({
      features: s.features.map((f) => (f.id === id ? { ...feature, visible: feature.visible ?? f.visible, suppressed: feature.suppressed ?? f.suppressed, ...(f.bodyGroupId ? { bodyGroupId: f.bodyGroupId } : {}) } : f)),
    })),
  removeFeature: (id) =>
    set((s) => ({ features: s.features.filter((f) => f.id !== id) })),
  clear: () => set({ features: [] }),
}));

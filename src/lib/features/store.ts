import { create } from "zustand";
import { bindSketchDependencies } from "./sketchDependencies";
import type { Feature } from "./types";

type FeatureState = {
  features: Feature[];
  addFeature: (feature: Feature) => void;
  updateFeature: (id: string, feature: Feature) => void;
  removeFeature: (id: string) => void;
  clear: () => void;
};

// Preserve sketch references before changing geometry so downstream rebuilds
// follow entity identity rather than searching for the old coordinates.
export const useFeatureStore = create<FeatureState>((set) => ({
  features: [],
  addFeature: (feature) =>
    set((s) => {
      const features = bindSketchDependencies([...s.features, feature]);
      const operation = features[features.length - 1];
      const consumed = new Set([
        ...(operation.sketchReference ? [operation.sketchReference.sketchId] : []),
        ...(operation.type === "sweep" ? [operation.pathFeatureId] : []),
        ...(operation.type === "loft" ? operation.sectionIds : []),
      ]);
      return { features: features.map(f => f.type === "sketch" && consumed.has(f.id) ? { ...f, visible: false } : f) };
    }),
  updateFeature: (id, feature) =>
    set((s) => ({
      features: bindSketchDependencies(s.features).map((f) => (f.id === id ? { ...feature, sketchReference: feature.sketchReference ?? f.sketchReference, visible: feature.visible ?? f.visible, suppressed: feature.suppressed ?? f.suppressed, ...(f.bodyGroupId ? { bodyGroupId: f.bodyGroupId } : {}) } : f)),
    })),
  removeFeature: (id) =>
    set((s) => ({ features: bindSketchDependencies(s.features).filter((f) => f.id !== id) })),
  clear: () => set({ features: [] }),
}));

import { create } from "zustand";
import { createEmptyPartProperties, type PartProperties } from "@/lib/project/partProperties";

// Store das "iProperties" da peça aberta no Modelador (ver
// src/lib/project/partProperties.ts). Separada de useFeatureStore de
// propósito: não é geometria, não entra no desfazer/refazer do modelo (o
// Inventor também não desfaz edição de iProperties junto com features) e
// não invalida vista/sólido nenhum — só viaja junto no arquivo salvo.
type PartPropertiesState = {
  properties: PartProperties;
  update: (patch: Partial<PartProperties>) => void;
  load: (properties: PartProperties) => void;
  clear: () => void;
};

export const usePartPropertiesStore = create<PartPropertiesState>((set) => ({
  properties: createEmptyPartProperties(),
  update: (patch) => set((s) => ({ properties: { ...s.properties, ...patch } })),
  load: (properties) => set({ properties }),
  clear: () => set({ properties: createEmptyPartProperties() }),
}));

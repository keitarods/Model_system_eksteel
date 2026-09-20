import type { Feature, ImportedFeature } from "@/lib/features/types";
import { recognizeOperations, type Recognition } from "./recognizeOperations";

export type AutomaticRecognition = {
  source: ImportedFeature;
  status: "reconstructed" | "solid";
  method?: "extrude" | "revolve";
  features: Feature[];
  attempts: string[];
  validation?: Pick<Recognition, "differenceVolume" | "toleranceVolume">;
};

/** A failed hypothesis leaves the exact original BREP intact. No inferred sheet process. */
export function automaticallyRecognize(source: ImportedFeature, id: () => string): AutomaticRecognition {
  const attempts: string[] = [];
  if (source.format === "step") {
    for (const method of ["extrude", "revolve"] as const) {
      try {
        const result = recognizeOperations(source, method, id);
        return {
          source, status: "reconstructed", method, features: result.features, attempts,
          validation: { differenceVolume: result.differenceVolume, toleranceVolume: result.toleranceVolume },
        };
      } catch (error) {
        attempts.push(`${method === "extrude" ? "Extrusão" : "Revolução"}: ${error instanceof Error ? error.message : "falha geométrica"}`);
      }
    }
  } else attempts.push("Reconhecimento analítico disponível somente para STEP.");
  return { source, status: "solid", features: [source], attempts };
}

/** Isolate each body's operation chain so cuts cannot affect neighbouring imported bodies. */
export async function automaticallyRecognizeBodies(
  sources: ImportedFeature[], id: () => string,
  onProgress?: (completed: number, total: number) => void,
): Promise<{ features: Feature[]; results: AutomaticRecognition[] }> {
  const features: Feature[] = [], results: AutomaticRecognition[] = [];
  for (const source of sources) {
    await new Promise(resolve => setTimeout(resolve, 0));
    const result = automaticallyRecognize(source, id);
    results.push(result);
    if (result.status === "reconstructed") {
      const bodyGroupId = id();
      features.push(...result.features.map(feature => ({ ...feature, bodyGroupId, label: `${source.label} · ${feature.label}` })));
    } else features.push(source);
    onProgress?.(results.length, sources.length);
  }
  return { features, results };
}

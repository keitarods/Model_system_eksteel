import { FaceFinder } from "replicad";
import type { Sketch, Solid } from "replicad";
import type { Feature, LoftFeature, ShellFeature } from "@/lib/features/types";
import { findProfileSource, profileToDrawing } from "./geometry";
import { toReplicadPlane } from "./plane";
export function buildLoft(feature: LoftFeature, features: Feature[]): Solid {
    if (feature.sectionIds.length < 2 || new Set(feature.sectionIds).size !== feature.sectionIds.length)
        throw new Error("Loft requer ao menos dois esboços distintos, na ordem das seções.");
    const sketches: Sketch[] = [];
    let consumed = false;
    try {
        for (const id of feature.sectionIds) {
            const source = features.find(f => f.id === id);
            if (!source || source.type !== 'sketch')
                throw new Error("Seção de loft ausente: " + id);
            const drawing = profileToDrawing(findProfileSource(source.shapes, source.points));
            if (!drawing)
                throw new Error("Cada seção de loft precisa de um perfil fechado.");
            sketches.push(drawing.sketchOnPlane(toReplicadPlane(source.plane)) as Sketch);
        }
        const solid = sketches[0].loftWith(sketches.slice(1), { ruled: feature.ruled }) as Solid;
        consumed = true; // Replicad deletes the input sketches on success.
        return solid;
    }
    finally {
        if (!consumed)
            for (const sketch of sketches)
                sketch.delete();
    }
}
export function buildShell(solid: Solid, feature: ShellFeature): Solid {
    if (!Number.isFinite(feature.thickness) || feature.thickness <= 0)
        throw new Error("Espessura deve ser positiva.");
    // Replicad negates the supplied thickness before calling OpenCascade.
    const filter = new FaceFinder().inPlane(toReplicadPlane(feature.openingPlane));
    try {
        if (filter.find(solid).length !== 1)
            throw new Error("Escolha um plano que contenha exatamente uma face de abertura.");
        return solid.shell({ thickness: feature.thickness, filter }) as Solid;
    }
    finally {
        filter.delete();
    }
}

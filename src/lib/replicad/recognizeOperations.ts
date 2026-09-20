import { cast, deserializeShape, getOC, isShape3D, iterTopo, makePolygon, measureArea, measureVolume, type Face, type Solid, type Sketch } from "replicad";
import type { Feature, ImportedFeature, SketchFeature } from "@/lib/features/types";
import { reconstructFaceSketch } from "./reconstructSketch";
import { findProfileSources, profileToDrawing, type ProfileSource } from "./geometry";
import { rebuildModel } from "./build-model";
import { worldToLocalPoint } from "./plane";
type V = [
    number,
    number,
    number
];
export type RecognitionMode = "extrude" | "revolve" | "sheetMetal";
export type Recognition = {
    features: Feature[];
    differenceVolume: number;
    toleranceVolume: number;
    notes: string[];
};
const dot = (a: V, b: V) => a.reduce((s, x, i) => s + x * b[i], 0);
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V, b: V, k = 1): V => [a[0] + k * b[0], a[1] + k * b[1], a[2] + k * b[2]];
function vector(v: {
    x: number;
    y: number;
    z: number;
    delete(): void;
}): V { const p: V = [v.x, v.y, v.z]; v.delete(); return p; }
/** Compare actual occupied volumes, not merely equal volume or equal bounds. */
export function compareReconstruction(original: Solid, features: Feature[]) {
    const originalVolume = measureVolume(original);
    if (!Number.isFinite(originalVolume) || originalVolume <= 0)
        throw new Error("Corpo original sem volume válido.");
    const candidate = rebuildModel(features);
    if (!candidate)
        throw new Error("A reconstrução não gerou sólido.");
    try {
        const oc = getOC(), check = new oc.BRepCheck_Analyzer(candidate.wrapped, true, false);
        try {
            if (!check.IsValid_2())
                throw new Error("A reconstrução produziu geometria inválida.");
        }
        finally {
            check.delete();
        }
        const candidateVolume = measureVolume(candidate);
        if (!Number.isFinite(candidateVolume) || candidateVolume <= 0)
            throw new Error("Reconstrução sem volume válido.");
        const missing = original.cut(candidate);
        let extra: ReturnType<Solid['cut']> | undefined;
        try {
            extra = candidate.cut(original);
        }
        catch (error) {
            missing.delete();
            throw error;
        }
        try {
            const differenceVolume = Math.abs(measureVolume(missing)) + Math.abs(measureVolume(extra));
            const toleranceVolume = Math.max(1e-7, originalVolume * 1e-8);
            if (!Number.isFinite(differenceVolume) || differenceVolume > toleranceVolume)
                throw new Error("As operações reconhecidas não reproduzem o corpo dentro da tolerância.");
            return { differenceVolume, toleranceVolume };
        }
        finally {
            missing.delete();
            extra.delete();
        }
    }
    finally {
        candidate.delete();
    }
}
function faceSketch(face: Face, id: () => string): SketchFeature {
    const edges = face.edges;
    try {
        const point = vector(edges[0].pointAt(.5)), normal = vector(face.normalAt(point));
        // Use this exact face, avoiding ambiguities on coplanar edges and centers inside holes.
        return reconstructFaceSketch({ get faces() { return [face.clone()]; } } as Solid, point, normal, id);
    }
    finally {
        edges.forEach(e => e.delete());
    }
}
function profiles(sketch: SketchFeature): NonNullable<ProfileSource>[] {
    return findProfileSources(sketch.shapes, sketch.points, sketch.shapes.map(s => s.id)).sort((a, b) => area(b) - area(a));
}
function area(profile: NonNullable<ProfileSource>) {
    const face = (profileToDrawing(profile)!.sketchOnPlane("XY") as Sketch).face();
    try {
        return measureArea(face);
    }
    finally {
        face.delete();
    }
}
function extent(solid: Solid, origin: V, direction: V): [
    number,
    number
] {
    // Exact for the supported planar/cylindrical prismatic caps; validation rejects other geometry.
    const edges = solid.edges;
    let lo = Infinity, hi = -Infinity;
    try {
        for (const edge of edges)
            for (const t of [0, .25, .5, .75, 1]) {
                const d = dot(sub(vector(edge.pointAt(t)), origin), direction);
                lo = Math.min(lo, d);
                hi = Math.max(hi, d);
            }
    }
    finally {
        edges.forEach(e => e.delete());
    }
    return [lo, hi];
}
function prismatic(solid: Solid, sheet: boolean, id: () => string): Recognition {
    const faces = solid.faces;
    try {
        const planar = faces.filter(f => f.geomType === 'PLANE').sort((a, b) => measureArea(b) - measureArea(a));
        for (const face of planar.slice(0, 40)) {
            try {
                const sketch = faceSketch(face, id), loops = profiles(sketch);
                if (!loops.length)
                    continue;
                const [lo, hi] = extent(solid, sketch.plane.origin, sketch.plane.normal);
                if (Math.min(Math.abs(lo), Math.abs(hi)) > 1e-5)
                    continue;
                const depth = hi - lo;
                if (!(depth > 1e-6))
                    continue;
                const direction = Math.abs(lo) < Math.abs(hi) ? 'normal' : 'flipped';
                const features: Feature[] = [sketch];
                if (sheet) {
                    // Flat stock only: thickness must be the small dimension, not an arbitrary extrusion axis.
                    const outerArea = area(loops[0]);
                    if (depth > Math.sqrt(outerArea) * .2)
                        continue;
                    features.push({ id: id(), type: 'sheetMetal', label: `Chapa reconhecida · ${depth.toFixed(4)} mm`, thickness: depth });
                    features.push({ id: id(), type: 'face', label: 'Face de chapa reconstruída', profile: loops[0], plane: sketch.plane, direction });
                }
                else
                    features.push({ id: id(), type: 'extrude', label: 'Extrusão reconstruída', profile: loops[0], plane: sketch.plane, depth, direction, cut: false });
                for (const loop of loops.slice(1)) {
                    if (loop.kind === 'circle')
                        features.push({ id: id(), type: 'hole', label: 'Furo passante reconhecido', plane: sketch.plane, center: { x: loop.cx, y: loop.cy }, radius: loop.r, through: true, depth, direction });
                    else
                        features.push({ id: id(), type: 'extrude', label: 'Recorte passante reconstruído', plane: sketch.plane, profile: loop, depth, direction, cut: true });
                }
                // Planar caps of blind circular holes may not be on the selected end face.
                const cylinders = faces.filter(f => f.geomType === 'CYLINDRE');
                for (const cylinder of cylinders) {
                    const oc = getOC(), adapter = new oc.BRepAdaptor_Surface_2(cylinder.wrapped, true);
                    try {
                        if (Math.abs(adapter.LastUParameter() - adapter.FirstUParameter() - 2 * Math.PI) > 1e-6)
                            continue;
                        const c = adapter.Cylinder(), axis = c.Axis(), loc = axis.Location(), dir = axis.Direction();
                        const axisOrigin: V = [loc.X(), loc.Y(), loc.Z()], axisDir: V = [dir.X(), dir.Y(), dir.Z()], radius = c.Radius();
                        loc.delete();
                        dir.delete();
                        axis.delete();
                        c.delete();
                        if (Math.abs(dot(axisDir, sketch.plane.normal)) < .999999)
                            continue;
                        const sample = vector(cylinder.pointOnSurface(.5, .5));
                        const normal = vector(cylinder.normalAt(sample)), radial = sub(sub(sample, axisOrigin), axisDir.map(v => v * dot(sub(sample, axisOrigin), axisDir)) as V);
                        if (dot(normal, radial) >= 0)
                            continue; // convex cylinder is material, not a hole
                        const center = worldToLocalPoint(sketch.plane, axisOrigin);
                        if (features.some(f => f.type === 'hole' && Math.hypot(f.center.x - center.x, f.center.y - center.y) < 1e-5 && Math.abs(f.radius - radius) < 1e-5))
                            continue;
                        const start = vector(cylinder.pointOnSurface(0, 0)), end = vector(cylinder.pointOnSurface(0, 1));
                        const z1 = dot(sub(start, sketch.plane.origin), sketch.plane.normal), z2 = dot(sub(end, sketch.plane.origin), sketch.plane.normal);
                        const min = Math.min(z1, z2), max = Math.max(z1, z2);
                        const opensLow = Math.abs(min - lo) < 1e-5, opensHigh = Math.abs(max - hi) < 1e-5;
                        if (!opensLow && !opensHigh)
                            continue;
                        const plane = { ...sketch.plane, origin: add(sketch.plane.origin, sketch.plane.normal, opensLow ? min : max) };
                        features.push({ id: id(), type: 'hole', label: 'Furo cilíndrico reconhecido', plane, center, radius, through: opensLow && opensHigh, depth: max - min, direction: opensLow ? 'normal' : 'flipped' });
                    }
                    finally {
                        adapter.delete();
                    }
                }
                const check = compareReconstruction(solid, features);
                return { features, ...check, notes: [sheet ? 'Chapa plana de espessura constante; nenhuma dobra inferida.' : 'Seção prismática validada com recortes e furos cilíndricos.', 'Cotas do esboço são de referência. A sequência é reconstruída, não o histórico original.'] };
            }
            catch { /* Try another cap; publish only a validated complete reconstruction. */ }
        }
        if (sheet)
            throw new Error('Chapa não reconhecida: não foi comprovada uma chapa plana de espessura constante. Para chapa dobrada faltam dados verificáveis de sequência de dobras, raio interno, alívios e regra de desenvolvimento/fator K. Nenhum valor será presumido.');
        throw new Error('Não foi encontrada extrusão compatível com o corpo completo. Degraus, rebaixos, furos inclinados ou superfícies livres podem exigir operações ainda não reconhecidas.');
    }
    finally {
        faces.forEach(f => f.delete());
    }
}
function revolved(solid: Solid, id: () => string): Recognition {
    const faces = solid.faces;
    try {
        for (const face of faces.filter(f => f.geomType === 'CYLINDRE').slice(0, 20)) {
            const oc = getOC(), adapter = new oc.BRepAdaptor_Surface_2(face.wrapped, true);
            try {
                const cylinder = adapter.Cylinder(), axis = cylinder.Axis(), location = axis.Location(), direction = axis.Direction();
                const origin: V = [location.X(), location.Y(), location.Z()], dir: V = [direction.X(), direction.Y(), direction.Z()];
                location.delete();
                direction.delete();
                axis.delete();
                cylinder.delete();
                const radial = radialDirection(dir);
                const bounds = solid.boundingBox;
                const span = Math.hypot(bounds.width, bounds.height, bounds.depth) * 3;
                bounds.delete();
                const [lo, hi] = extent(solid, origin, dir);
                const section = makePolygon([add(origin, dir, lo - span), add(add(origin, dir, lo - span), radial, span), add(add(origin, dir, hi + span), radial, span), add(origin, dir, hi + span)]);
                const progress = new oc.Message_ProgressRange_1();
                const common = new oc.BRepAlgoAPI_Common_3(solid.wrapped, section.wrapped, progress);
                let result: ReturnType<typeof cast> | undefined;
                try {
                    common.Build(progress);
                    result = cast(common.Shape());
                    const sections = result.faces;
                    try {
                        if (sections.length !== 1)
                            continue;
                        const sketch = faceSketch(sections[0], id), loops = profiles(sketch);
                        if (loops.length !== 1)
                            continue;
                        const localOrigin = worldToLocalPoint(sketch.plane, origin), localEnd = worldToLocalPoint(sketch.plane, add(origin, dir));
                        const features: Feature[] = [sketch, { id: id(), type: 'revolve', label: 'Revolução reconstruída · 360°', profile: loops[0], plane: sketch.plane, axisOrigin: localOrigin, axisDirection: { x: localEnd.x - localOrigin.x, y: localEnd.y - localOrigin.y }, angle: 360 }];
                        const check = compareReconstruction(solid, features);
                        return { features, ...check, notes: ['Eixo extraído de superfície cilíndrica; perfil de meia-seção e revolução completa validados.', 'Não recupera a ordem original de torneamento.'] };
                    }
                    finally {
                        sections.forEach(f => f.delete());
                    }
                }
                finally {
                    result?.delete();
                    common.delete();
                    progress.delete();
                    section.delete();
                }
            }
            catch { /* Another axis may be the axis of revolution. */ }
            finally {
                adapter.delete();
            }
        }
        throw new Error('Revolução não reconhecida: requer eixo cilíndrico identificável e meia-seção única de retas/arcos que reproduza o corpo por 360°.');
    }
    finally {
        faces.forEach(f => f.delete());
    }
}
function radialDirection(dir: V) {
    const ref: V = Math.abs(dir[2]) < .9 ? [0, 0, 1] : [1, 0, 0];
    const cross: V = [dir[1] * ref[2] - dir[2] * ref[1], dir[2] * ref[0] - dir[0] * ref[2], dir[0] * ref[1] - dir[1] * ref[0]];
    const length = Math.hypot(...cross), radial = cross.map(x => x / length) as V;
    return radial;
}
export function recognizeOperations(source: ImportedFeature, mode: RecognitionMode, id: () => string): Recognition {
    if (source.format !== 'step')
        throw new Error('Reconhecimento de operações exige STEP com geometria CAD analítica.');
    const shape = deserializeShape(source.brep);
    try {
        if (!isShape3D(shape))
            throw new Error('Corpo STEP inválido.');
        const solids = Array.from(iterTopo(shape.wrapped, 'solid'));
        const count = solids.length;
        solids.forEach(s => s.delete());
        if (count !== 1)
            throw new Error('Selecione um único corpo STEP por reconstrução.');
        const faces = shape.faces;
        const faceCount = faces.length;
        faces.forEach(f => f.delete());
        if (faceCount > 200)
            throw new Error('Reconhecimento limitado a 200 faces por corpo.');
        return mode === 'revolve' ? revolved(shape as Solid, id) : prismatic(shape as Solid, mode === 'sheetMetal', id);
    }
    finally {
        shape.delete();
    }
}
/** Optional companion process document. Never infer manufacturing data from folded geometry. */
export function recognizeSheetRecipe(source: ImportedFeature, json: string, id: () => string): Recognition {
    if (source.format !== 'step')
        throw new Error('Receita de chapa requer um corpo STEP.');
    if (json.length > 2000000)
        throw new Error('Dados de chapa limitados a 2 MB.');
    const data = JSON.parse(json);
    if (data?.format !== 'eksteel-sheet-reconstruction' || data.version !== 1 || !Array.isArray(data.features))
        throw new Error('Documento de chapa inválido: esperado eksteel-sheet-reconstruction versão 1.');
    const input = data.features as Feature[];
    if (!input.length || input.length > 200)
        throw new Error('Informe de 1 a 200 operações de chapa.');
    const seen = new Set<string>();
    let thickness: number | undefined;
    let faces = 0;
    let bends = 0;
    const validNumbers = (value: unknown): boolean => typeof value === 'number' ? Number.isFinite(value) : Array.isArray(value) ? value.every(validNumbers) : value && typeof value === 'object' ? Object.values(value).every(validNumbers) : true;
    for (const feature of input) {
        if (!feature || !['sketch', 'sheetMetal', 'face', 'flange', 'hole'].includes(feature.type) || typeof feature.id !== 'string' || seen.has(feature.id) || !validNumbers(feature))
            throw new Error('Operação de chapa inválida, duplicada ou não suportada.');
        if (feature.type === 'sheetMetal') {
            if (thickness !== undefined || faces || !(feature.thickness > 0))
                throw new Error('Informe uma regra de espessura positiva antes das faces.');
            thickness = feature.thickness;
        }
        if (feature.type === 'face') {
            if (thickness === undefined || !feature.profile || !feature.plane)
                throw new Error('Face requer regra de chapa, perfil e plano explícitos.');
            faces++;
        }
        if (feature.type === 'flange') {
            const parent = input.find(f => f.id === feature.parentId);
            if (!faces || !seen.has(feature.parentId) || !parent || !['face', 'flange'].includes(parent.type) || !Array.isArray(feature.edgeStart) || !Array.isArray(feature.edgeEnd) || feature.edgeStart.length !== 3 || feature.edgeEnd.length !== 3 || !(feature.length > 0) || !(feature.angle > 0 && feature.angle < 180))
                throw new Error('Dobra requer face pai anterior, aresta, comprimento e ângulo válidos.');
            if (feature.innerRadius === undefined || feature.kFactor === undefined)
                throw new Error('Dados insuficientes: cada dobra exige innerRadius e kFactor explícitos; não serão usados valores padrão.');
            if (!(feature.innerRadius > 0) || !(feature.kFactor >= 0 && feature.kFactor <= 1))
                throw new Error('Raio interno ou fator K inválido.');
            bends++;
        }
        if (feature.type === 'hole' && (!faces || !(feature.radius > 0) || !(feature.depth > 0)))
            throw new Error('Furo requer corpo e dimensões válidas.');
        seen.add(feature.id);
    }
    if (thickness === undefined || !faces)
        throw new Error('Dados insuficientes: faltam regra de chapa e face base.');
    const mapping = new Map(input.map(f => [f.id, id()]));
    const features = input.map(f => ({ ...f, id: mapping.get(f.id)!, ...(f.type === 'flange' ? { parentId: mapping.get(f.parentId)! } : {}) }));
    const shape = deserializeShape(source.brep);
    try {
        if (!isShape3D(shape))
            throw new Error('STEP inválido.');
        const check = compareReconstruction(shape as Solid, features);
        // Also validate that the supplied manufacturing recipe can produce a flat pattern.
        const flat = rebuildModel(features, { flatten: true });
        if (!flat)
            throw new Error('Não foi possível planificar a receita.');
        flat.delete();
        return { features, ...check, notes: [`${bends} dobra(s) reconstruída(s) a partir de dados explícitos e comparadas ao STEP.`, 'Fator K vem do documento de fabricação: não pode ser comprovado pela geometria dobrada.'] };
    }
    finally {
        shape.delete();
    }
}

import type { Point, SketchPoint, SketchShape } from "./types";
type Points = Record<string, SketchPoint>;
export type SketchEdit = {
    points: Points;
    shapes: SketchShape[];
    removeIds: string[];
};
const EPS = 1e-8;
let serial = 0;
const id = () => `edit-${Date.now().toString(36)}-${(++serial).toString(36)}`;
const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const at = (a: Point, d: Point, t: number): Point => ({ x: a.x + d.x * t, y: a.y + d.y * t });
function addPoint(edit: SketchEdit, p: Point) {
    const existing = Object.values(edit.points).find(q => Math.hypot(q.x - p.x, q.y - p.y) < EPS);
    if (existing)
        return existing.id;
    const key = id();
    edit.points[key] = { ...p, id: key };
    return key;
}
function empty(): SketchEdit { return { points: {}, shapes: [], removeIds: [] }; }
function segment(edit: SketchEdit, a: Point, b: Point) {
    edit.shapes.push({ id: id(), type: "line", p1: addPoint(edit, a), p2: addPoint(edit, b) });
}
export function shapePointIds(s: SketchShape): string[] {
    if (s.type === 'spline') return [s.p1,s.p2,s.control1,s.control2];
    if (s.type === 'circle')
        return [s.center];
    if (s.type === 'point')
        return [s.pointId];
    if (s.type === 'slot')
        return [s.center1, s.center2];
    return s.type === 'arc' ? [s.p1, s.p2, s.center] : [s.p1, s.p2];
}
/** Mirror exact primitives and shared topology about an arbitrary sketch line.
 * Copies have no inherited fixed/projected/axis locks: those may be false after reflection. */
export function mirrorShapes(shapes: SketchShape[], points: Points, axisA: Point, axisB: Point): SketchEdit {
    const d = sub(axisB, axisA), len = d.x * d.x + d.y * d.y;
    if (!Number.isFinite(len) || len < EPS)
        throw new Error('O eixo de espelhamento precisa ter comprimento.');
    if (shapes.some(s => s.type === 'rect')) {
        const expanded = empty();
        const pool = { ...points };
        const sources: SketchShape[] = [];
        for (const shape of shapes) {
            if (shape.type !== 'rect') {
                sources.push(shape);
                continue;
            }
            const a = points[shape.p1], b = points[shape.p2];
            const vertices = [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
            vertices.forEach((p, i) => segment(expanded, p, vertices[(i + 1) % 4]));
        }
        Object.assign(pool, expanded.points);
        return mirrorShapes([...sources, ...expanded.shapes], pool, axisA, axisB);
    }
    const edit = empty(), map = new Map<string, string>();
    for (const s of shapes)
        for (const key of shapePointIds(s))
            if (!map.has(key)) {
                const p = points[key];
                if (!p)
                    throw new Error('Geometria com ponto ausente.');
                const foot = at(axisA, d, ((p.x - axisA.x) * d.x + (p.y - axisA.y) * d.y) / len);
                map.set(key, addPoint(edit, { x: 2 * foot.x - p.x, y: 2 * foot.y - p.y }));
            }
    for (const s of shapes) {
        const copy = { ...s, id: id() } as SketchShape;
        if (copy.type === 'line') {
            delete copy.axisLock;
            delete copy.isProjected;
        }
        for (const field of ['p1', 'p2', 'center', 'center1', 'center2', 'pointId', 'control1', 'control2'] as const) {
            if (field in copy) {
                const obj = copy as unknown as Record<string, string>;
                obj[field] = map.get(obj[field])!;
            }
        }
        edit.shapes.push(copy);
    }
    return edit;
}
/** Signed left offset for a line; positive outward offset for circles/slots.
 * Closed polygons use intersections of adjacent offset lines (miter joins). */
export function offsetShapes(shapes: SketchShape[], points: Points, distance: number): SketchEdit {
    if (!Number.isFinite(distance) || Math.abs(distance) < EPS)
        throw new Error('Informe uma distância diferente de zero.');
    const edit = empty();
    if (shapes.length === 1) {
        const s = shapes[0];
        if (s.type === 'circle' || s.type === 'slot') {
            const radius = s.radius + distance;
            if (radius <= EPS)
                throw new Error('O offset eliminaria o raio.');
            if (s.type === 'circle') {
                edit.shapes.push({ ...s, id: id(), center: addPoint(edit, points[s.center]), radius });
            } else {
                edit.shapes.push({ ...s, id: id(), center1: addPoint(edit, points[s.center1]), center2: addPoint(edit, points[s.center2]), radius });
            }
            return edit;
        }
    }
    if (shapes.some(s => s.type !== 'line'))
        throw new Error('Offset disponível para linha, círculo, rasgo ou contorno fechado de linhas.');
    const lines = shapes as Extract<SketchShape, {
        type: 'line';
    }>[];
    const ordered: Point[] = [];
    const remaining = [...lines];
    const first = remaining.shift();
    if (!first)
        throw new Error('Selecione geometria.');
    ordered.push(points[first.p1], points[first.p2]);
    let current = first.p2;
    while (remaining.length) {
        const i = remaining.findIndex(s => s.p1 === current || s.p2 === current);
        if (i < 0)
            throw new Error('Selecione um único contorno conectado.');
        const s = remaining.splice(i, 1)[0];
        current = s.p1 === current ? s.p2 : s.p1;
        ordered.push(points[current]);
    }
    if (ordered.some(p => !p))
        throw new Error('Geometria com ponto ausente.');
    const closed = current === first.p1;
    if (lines.length > 1 && !closed)
        throw new Error('Para várias linhas, selecione um contorno fechado.');
    const shifted = ordered.slice(0, -1).map((a, i) => { const d = sub(ordered[i + 1], a), l = Math.hypot(d.x, d.y); if (l < EPS)
        throw new Error('Contorno contém linha nula.'); return { a: { x: a.x - d.y / l * distance, y: a.y + d.x / l * distance }, d }; });
    if (!closed) {
        segment(edit, shifted[0].a, at(shifted[0].a, shifted[0].d, 1));
        return edit;
    }
    const vertices = shifted.map((line, i) => { const prev = shifted[(i + shifted.length - 1) % shifted.length]; const den = cross(prev.d, line.d); if (Math.abs(den) < EPS)
        throw new Error('Remova lados consecutivos colineares antes do offset.'); return at(prev.a, prev.d, cross(sub(line.a, prev.a), line.d) / den); });
    // Reject collapsed/flipped edges and self-intersections rather than emit invalid profiles.
    for (let i = 0; i < vertices.length; i++) {
        const d = sub(vertices[(i + 1) % vertices.length], vertices[i]);
        if (d.x * shifted[i].d.x + d.y * shifted[i].d.y <= EPS)
            throw new Error('Offset excede o espaço disponível no contorno.');
        for (let j = i + 2; j < vertices.length; j++) {
            if (i === 0 && j === vertices.length - 1)
                continue;
            const e = sub(vertices[(j + 1) % vertices.length], vertices[j]), den = cross(d, e);
            if (Math.abs(den) < EPS)
                continue;
            const delta = sub(vertices[j], vertices[i]), t = cross(delta, e) / den, u = cross(delta, d) / den;
            if (t > EPS && t < 1 - EPS && u > EPS && u < 1 - EPS)
                throw new Error('Offset produz auto-interseção.');
        }
    }
    vertices.forEach((p, i) => segment(edit, p, vertices[(i + 1) % vertices.length]));
    return edit;
}
/** Trim the clicked interval, or extend the nearest endpoint to the first boundary.
 * Boundaries include line segments and circles. Original shared points never move. */
export function trimExtend(shapes: SketchShape[], points: Points, lineId: string, click: Point, extend = false): SketchEdit {
    const line = shapes.find(s => s.id === lineId);
    if (!line || line.type !== 'line')
        throw new Error('Selecione uma linha.');
    const a = points[line.p1], b = points[line.p2], d = sub(b, a), len = d.x * d.x + d.y * d.y;
    if (len < EPS)
        throw new Error('Linha sem comprimento.');
    const ts: number[] = [];
    for (const s of shapes) {
        if (s.id === lineId)
            continue;
        if (s.type === 'line') {
            const c = points[s.p1], e = sub(points[s.p2], c), den = cross(d, e);
            if (Math.abs(den) < EPS)
                continue;
            const delta = sub(c, a), t = cross(delta, e) / den, u = cross(delta, d) / den;
            if (u >= -EPS && u <= 1 + EPS)
                ts.push(t);
        }
        else if (s.type === 'circle') {
            const f = sub(a, points[s.center]), B = 2 * (f.x * d.x + f.y * d.y), C = f.x * f.x + f.y * f.y - s.radius * s.radius, disc = B * B - 4 * len * C;
            if (disc >= 0)
                ts.push((-B - Math.sqrt(disc)) / (2 * len), (-B + Math.sqrt(disc)) / (2 * len));
        }
    }
    const sorted = [...new Set(ts.map(t => Math.round(t * 1e10) / 1e10))].sort((a, b) => a - b);
    const t = ((click.x - a.x) * d.x + (click.y - a.y) * d.y) / len, edit = empty();
    edit.removeIds = [lineId];
    const add = (lo: number, hi: number) => {
        if (hi - lo < EPS)
            return;
        const p1 = Math.abs(lo) < EPS ? line.p1 : addPoint(edit, at(a, d, lo));
        const p2 = Math.abs(hi - 1) < EPS ? line.p2 : addPoint(edit, at(a, d, hi));
        edit.shapes.push({ ...line, id: edit.shapes.length ? id() : line.id, p1, p2 });
    };
    if (extend) {
        const end = t >= .5;
        const boundary = end ? sorted.find(v => v > 1 + EPS) : sorted.filter(v => v < -EPS).at(-1);
        if (boundary === undefined)
            throw new Error('Nenhum limite encontrado para estender.');
        add(end ? 0 : boundary, end ? boundary : 1);
    }
    else {
        const cuts = sorted.filter(v => v > EPS && v < 1 - EPS);
        if (cuts.some(cut => Math.abs(t - cut) < EPS)) throw new Error("Clique dentro do trecho, afastado da interseção.");
        if (!cuts.length)
            throw new Error('A linha não cruza nenhum limite.');
        const lo = [0, ...cuts].filter(v => v < t - EPS).at(-1) ?? 0, hi = [...cuts, 1].find(v => v > t + EPS) ?? 1;
        add(0, lo);
        add(hi, 1);
    }
    return edit;
}
/** A free three-point arc is stored as two existing minor arcs. Split each side
 * when necessary so the current BREP/DXF minor-arc convention remains exact. */
export function threePointArc(a: Point, through: Point, b: Point): SketchEdit {
    if (![a.x, a.y, through.x, through.y, b.x, b.y].every(Number.isFinite))
        throw new Error("Coordenadas inválidas.");
    const u = sub(through, a), v = sub(b, a), den = 2 * cross(u, v);
    if (Math.abs(den) < EPS)
        throw new Error('Escolha três pontos não alinhados.');
    const uu = u.x * u.x + u.y * u.y, vv = v.x * v.x + v.y * v.y;
    const center = { x: a.x + (uu * v.y - vv * u.y) / den, y: a.y + (u.x * vv - v.x * uu) / den };
    const edit = empty(), centerId = addPoint(edit, center), r = Math.hypot(a.x - center.x, a.y - center.y);
    const angle = (p: Point) => Math.atan2(p.y - center.y, p.x - center.x);
    const ccw = cross(u, v) > 0;
    const side = (start: Point, end: Point) => {
        let sweep = angle(end) - angle(start);
        if (ccw && sweep < 0)
            sweep += 2 * Math.PI;
        if (!ccw && sweep > 0)
            sweep -= 2 * Math.PI;
        const count = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI - 1e-6)));
        let previous = start;
        for (let i = 1; i <= count; i++) {
            const next = i === count ? end : { x: center.x + r * Math.cos(angle(start) + sweep * i / count), y: center.y + r * Math.sin(angle(start) + sweep * i / count) };
            edit.shapes.push({ id: id(), type: 'arc', center: centerId, p1: addPoint(edit, previous), p2: addPoint(edit, next) });
            previous = next;
        }
    };
    side(a, through);
    side(through, b);
    return edit;
}

export function cubicSplineEdit(controls: Point[]): SketchEdit {
  if(controls.length!==4 || controls.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y))) throw new Error("Spline requer quatro pontos válidos.");
  if(controls.every(p=>Math.hypot(p.x-controls[0].x,p.y-controls[0].y)<EPS)) throw new Error("Spline sem comprimento.");
  const edit=empty();
  edit.shapes.push({id:id(),type:"spline",p1:addPoint(edit,controls[0]),control1:addPoint(edit,controls[1]),control2:addPoint(edit,controls[2]),p2:addPoint(edit,controls[3])});
  return edit;
}

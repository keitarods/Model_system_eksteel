import type { SketchEdit } from "@/lib/sketch/modify";
import { cubicSplineEdit, threePointArc } from "@/lib/sketch/modify";
/** ASCII DXF subset. Unsupported entities fail explicitly, never disappear silently.
 * Coordinates are converted to millimetres using $INSUNITS when present. */
let importSerial = 0;
export function parseDxf(text: string): SketchEdit {
    const rows = text.replace(/\r/g, '').trim().split('\n');
    if (rows.length % 2)
        throw new Error('DXF inválido: pares código/valor incompletos.');
    const pairs = Array.from({ length: rows.length / 2 }, (_, i) => ({ code: Number(rows[i * 2].trim()), value: rows[i * 2 + 1].trim() }));
    const unitIndex = pairs.findIndex(p => p.code === 9 && p.value === '$INSUNITS');
    const units = unitIndex < 0 ? 0 : Number(pairs[unitIndex + 1]?.value);
    const scale = ({ 0: 1, 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000 } as Record<number, number>)[units];
    if (!scale)
        throw new Error('Unidade DXF não suportada; converta para milímetros.');
    const edit: SketchEdit = { points: {}, shapes: [], removeIds: [] };
    let serial = 0;
    const prefix = `dxf-${Date.now().toString(36)}-${++importSerial}-`;
    const newId = () => prefix + (++serial);
    const point = (x: number, y: number) => {
        const key = newId();
        edit.points[key] = { id: key, x: x * scale, y: y * scale };
        return key;
    };
    let entities = false;
    for (let i = 0; i < pairs.length; i++) {
        if (pairs[i].code === 2 && pairs[i].value === 'ENTITIES') {
            entities = true;
            continue;
        }
        if (!entities || pairs[i].code !== 0)
            continue;
        const kind = pairs[i].value;
        if (kind === 'ENDSEC')
            break;
        const data: {
            code: number;
            value: string;
        }[] = [];
        while (i + 1 < pairs.length && pairs[i + 1].code !== 0)
            data.push(pairs[++i]);
        const number = (code: number, fallback?: number) => {
            const raw = data.find(p => p.code === code)?.value;
            const value = raw === undefined ? fallback : Number(raw);
            if (value === undefined || !Number.isFinite(value))
                throw new Error(`DXF: coordenada ${code} inválida em ${kind}.`);
            return value;
        };
        if (number(30, 0) !== 0 || number(31, 0) !== 0 || number(38, 0) !== 0 || number(210, 0) !== 0 || number(220, 0) !== 0 || number(230, 1) !== 1)
            throw new Error('Importação DXF exige geometria 2D no plano XY.');
        if (kind === 'LINE')
            edit.shapes.push({ id: newId(), type: 'line', p1: point(number(10), number(20)), p2: point(number(11), number(21)) });
        else if (kind === 'CIRCLE') {
            const radius = number(40) * scale;
            if (radius <= 0)
                throw new Error('Raio DXF inválido.');
            edit.shapes.push({ id: newId(), type: 'circle', center: point(number(10), number(20)), radius });
        }
        else if (kind === 'SPLINE') {
            const knots = data.filter(p=>p.code===40).map(p=>Number(p.value));
            const weights = data.filter(p=>p.code===41).map(p=>Number(p.value));
            if(number(71,0)!==3 || number(73,0)!==4 || number(72,0)!==8 ||
               (number(70,0)&3)!==0 || weights.some(w=>w!==1) || knots.length!==8 ||
               knots.some(k=>!Number.isFinite(k)) || knots[4]<=knots[0] ||
               knots.slice(0,4).some(k=>k!==knots[0]) || knots.slice(4).some(k=>k!==knots[4]))
                throw new Error('SPLINE: suportada apenas cúbica não racional com quatro controles e nós fixados nas extremidades.');
            const controls: {x:number;y:number}[]=[];
            for(let j=0;j<data.length;j++) if(data[j].code===10) {
                const x=Number(data[j].value), y=Number(data[j+1]?.code===20?data[j+1].value:NaN);
                const z=data[j+2]?.code===30?Number(data[j+2].value):0;
                if(z!==0) throw new Error('SPLINE 3D não suportada.');
                controls.push({x:x*scale,y:y*scale});
            }
            const spline=cubicSplineEdit(controls);
            Object.assign(edit.points,spline.points);edit.shapes.push(...spline.shapes);
        }
        else if (kind === 'ARC') {
            const cx = number(10) * scale, cy = number(20) * scale, r = number(40) * scale;
            if (r <= 0)
                throw new Error('Raio DXF inválido.');
            const start = number(50) * Math.PI / 180;
            let sweep = (number(51) - number(50)) * Math.PI / 180;
            sweep = ((sweep % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
            if (sweep < 1e-9)
                throw new Error('Arco DXF degenerado.');
            const at = (a: number) => ({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
            const arc = threePointArc(at(start), at(start + sweep / 2), at(start + sweep));
            Object.assign(edit.points, arc.points);
            edit.shapes.push(...arc.shapes);
        }
        else if (kind === 'LWPOLYLINE') {
            if (data.some(p => p.code === 42 && Number(p.value) !== 0))
                throw new Error('Polyline com bulge não suportada; exporte como ARC/LINE.');
            const vertices: {
                x: number;
                y: number;
            }[] = [];
            for (let j = 0; j < data.length; j++)
                if (data[j].code === 10) {
                    const x = Number(data[j].value), y = Number(data[j + 1]?.code === 20 ? data[j + 1].value : NaN);
                    if (!Number.isFinite(x) || !Number.isFinite(y))
                        throw new Error('Vértice DXF inválido.');
                    vertices.push({ x, y });
                }
            if (vertices.length < 2)
                throw new Error('Polyline sem vértices suficientes.');
            const ids = vertices.map(p => point(p.x, p.y)), closed = (number(70, 0) & 1) !== 0;
            for (let j = 0; j < ids.length - (closed ? 0 : 1); j++)
                edit.shapes.push({ id: newId(), type: 'line', p1: ids[j], p2: ids[(j + 1) % ids.length] });
        }
        else if (kind === 'POINT')
            edit.shapes.push({ id: newId(), type: 'point', pointId: point(number(10), number(20)) });
        else
            throw new Error(`Entidade DXF não suportada: ${kind}. Exporte apenas o esboço 2D.`);
    }
    if (!edit.shapes.length)
        throw new Error('Nenhuma geometria 2D encontrada no DXF.');
    return edit;
}

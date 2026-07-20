import type { SketchPoint, SketchShape } from "@/lib/sketch/types";
import { sampleMinorArc } from "@/lib/sketch/render";

// Escritor DXF ASCII mínimo (R12/AC1009) — cobre só as entidades que o
// sketch produz (LINE, CIRCLE, POINT). Sem HEADER/TABLES completos (não
// tem camadas de verdade, cores etc.), mas é um DXF válido que abre em
// AutoCAD/LibreCAD/software de corte a laser. Exporta em coordenadas
// locais do plano do sketch (2D, "achatado" — igual um DXF de perfil pra
// corte, não uma projeção 3D).

function n(value: number): string {
  // DXF aceita ponto flutuante em texto puro; evita notação científica.
  return value.toFixed(4);
}

function dxfLine(x1: number, y1: number, x2: number, y2: number, layer: string): string {
  return `0\nLINE\n8\n${layer}\n10\n${n(x1)}\n20\n${n(y1)}\n30\n0.0\n11\n${n(x2)}\n21\n${n(y2)}\n31\n0.0\n`;
}

function dxfCircle(cx: number, cy: number, r: number, layer: string): string {
  return `0\nCIRCLE\n8\n${layer}\n10\n${n(cx)}\n20\n${n(cy)}\n30\n0.0\n40\n${n(r)}\n`;
}

function dxfPoint(x: number, y: number, layer: string): string {
  return `0\nPOINT\n8\n${layer}\n10\n${n(x)}\n20\n${n(y)}\n30\n0.0\n`;
}

const LAYER_GEOMETRY = "GEOMETRIA";
const LAYER_AXIS = "EIXO";

function wrapDxfDocument(entities: string[]): string {
  return (
    "0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1009\n0\nENDSEC\n" +
    "0\nSECTION\n2\nENTITIES\n" +
    entities.join("") +
    "0\nENDSEC\n0\nEOF\n"
  );
}

export function buildDxf(shapes: SketchShape[], points: Record<string, SketchPoint>): string {
  const entities: string[] = [];

  for (const shape of shapes) {
    if (shape.type === "circle") {
      const c = points[shape.center];
      if (c) entities.push(dxfCircle(c.x, c.y, shape.radius, LAYER_GEOMETRY));
      continue;
    }

    if (shape.type === "point") {
      const p = points[shape.pointId];
      if (p) entities.push(dxfPoint(p.x, p.y, LAYER_GEOMETRY));
      continue;
    }

    if (shape.type === "arc") {
      const a1 = points[shape.p1];
      const a2 = points[shape.p2];
      const c = points[shape.center];
      if (!a1 || !a2 || !c) continue;
      const r = Math.hypot(a1.x - c.x, a1.y - c.y);
      // Sem entidade ARC "de verdade" — aproxima por uma polilinha curta
      // (sampleMinorArc), que qualquer leitor de DXF/CNC entende sem
      // ambiguidade de sentido (CW/CCW) de um ARC paramétrico de verdade.
      const arcPts = sampleMinorArc(c.x, c.y, r, a1.x, a1.y, a2.x, a2.y, 16);
      for (let i = 0; i < arcPts.length - 1; i++) {
        entities.push(dxfLine(arcPts[i].x, arcPts[i].y, arcPts[i + 1].x, arcPts[i + 1].y, LAYER_GEOMETRY));
      }
      continue;
    }

    const p1 = points[shape.p1];
    const p2 = points[shape.p2];
    if (!p1 || !p2) continue;

    if (shape.type === "rect") {
      entities.push(dxfLine(p1.x, p1.y, p2.x, p1.y, LAYER_GEOMETRY));
      entities.push(dxfLine(p2.x, p1.y, p2.x, p2.y, LAYER_GEOMETRY));
      entities.push(dxfLine(p2.x, p2.y, p1.x, p2.y, LAYER_GEOMETRY));
      entities.push(dxfLine(p1.x, p2.y, p1.x, p1.y, LAYER_GEOMETRY));
      continue;
    }

    // line / linha de centro
    entities.push(dxfLine(p1.x, p1.y, p2.x, p2.y, shape.isCenterLine ? LAYER_AXIS : LAYER_GEOMETRY));
  }

  return wrapDxfDocument(entities);
}

// Mesmo escritor, mas a partir de segmentos de linha "crus" (x1,y1,x2,y2)
// já em coordenadas locais 2D — usado pra exportar o contorno de uma FACE
// do sólido 3D (que não tem shapes/pontos de sketch, só a geometria da
// aresta tesselada), ao estilo "Exportar face" do Inventor.
export function buildDxfFromSegments(segments: { x1: number; y1: number; x2: number; y2: number }[]): string {
  const entities = segments.map((seg) => dxfLine(seg.x1, seg.y1, seg.x2, seg.y2, LAYER_GEOMETRY));
  return wrapDxfDocument(entities);
}

/** Export the rendered sheet in paper millimetres. Curves are sampled, text stays TEXT.
 * Images (logos) and SVG fills are not CAD linework and are intentionally omitted.
 */
export function drawingSvgDxf(svg: SVGSVGElement): string {
  const root = svg.getScreenCTM();
  if (!root) throw new Error('Folha não visível para exportação.');
  const inverse = root.inverse();
  const height = svg.viewBox.baseVal.height;
  const rows = ['0','SECTION','2','HEADER','9','$ACADVER','1','AC1009','0','ENDSEC','0','SECTION','2','ENTITIES'];
  const n = (v: number) => { if (!Number.isFinite(v)) throw new Error('Coordenada inválida na folha.'); return v.toFixed(5); };
  for (const el of svg.querySelectorAll('path,line,polyline,polygon,rect,circle,ellipse,text')) {
    if (el.closest('defs,clipPath,mask')) continue;
    let hidden = false;
    for (let parent: Element | null = el; parent && parent !== svg; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) hidden = true;
    }
    if (hidden) continue;
    const element = el as SVGGraphicsElement;
    const screen = element.getScreenCTM();
    if (!screen) continue;
    const matrix = inverse.multiply(screen);
    const point = (x: number, y: number) => new DOMPoint(x,y).matrixTransform(matrix);
    if (el instanceof SVGTextElement) {
      const p = point(el.x.baseVal.numberOfItems ? el.x.baseVal.getItem(0).value : 0, el.y.baseVal.numberOfItems ? el.y.baseVal.getItem(0).value : 0);
      const size = parseFloat(getComputedStyle(el).fontSize) * Math.hypot(matrix.a,matrix.b);
      rows.push('0','TEXT','8','TEXTOS','10',n(p.x),'20',n(height-p.y),'40',n(size || 2.5),'1',(el.textContent || '').replace(/[\r\n]+/g,' '));
    } else if (el instanceof SVGGeometryElement) {
      const style = getComputedStyle(el);
      if (style.stroke === 'none' || Number(style.strokeOpacity) === 0) continue;
      // Sample disconnected absolute SVG subpaths separately: never add a bridge across a move.
      const geometries: SVGGeometryElement[] = [];
      if (el instanceof SVGPathElement) {
        const d = el.getAttribute('d') || '';
        if ((d.match(/[Mm]/g) || []).length > 1 && d.includes('m'))
          throw new Error('DXF: caminho composto relativo não suportado; exporte esta folha em PDF.');
        for (const part of d.split(/(?=M)/).filter(Boolean)) {
          const path = document.createElementNS('http://www.w3.org/2000/svg','path');
          path.setAttribute('d',part); geometries.push(path);
        }
      } else geometries.push(el);
      for (const geometry of geometries) {
      const length = geometry.getTotalLength();
      const count = el.tagName.toLowerCase() === 'line' ? 1 : Math.max(1, Math.ceil(length * Math.max(Math.hypot(matrix.a,matrix.b),Math.hypot(matrix.c,matrix.d)) / 0.2));
      if (count > 100000) throw new Error('Contorno muito complexo para exportar DXF.');
      let previous = geometry.getPointAtLength(0);
      for (let i=1;i<=count;i++) {
        const next=geometry.getPointAtLength(length*i/count);
        const a=point(previous.x,previous.y), b=point(next.x,next.y);
        rows.push('0','LINE','8',style.strokeDasharray==='none'?'CONTORNOS':'OCULTAS','10',n(a.x),'20',n(height-a.y),'11',n(b.x),'21',n(height-b.y));
        previous=next;
      }
      }
    }
  }
  return [...rows,'0','ENDSEC','0','EOF',''].join('\n');
}

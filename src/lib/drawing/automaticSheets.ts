import type { SheetShapeSource } from "./shapeSource";
import type { DrawingSheet, TitleBlockInfo } from "./types";
import { VIEW_ORIENTATION_LABELS } from "./types";
import { createSheetObject } from "./store";
import { autoDimensions, autoCircleNotes, autoRadiusNotes, bendSchedule } from "./autoDimensions";
import { bendAngles } from "./angularDimensions";
import { buildDrawingView, scaleToLabel } from "@/lib/replicad/technicalDrawing";
import { createBomTable, bomTableWidth, refreshBomRows } from "./bom";
import { layoutLeaders } from "./leaderLayout";

/** Caller initializes OpenCascade. Results stay detached until the user accepts the preview. */
export async function generateAutomaticSheets(documentSource: SheetShapeSource, autoDetails: boolean, titleBlock?: TitleBlockInfo): Promise<DrawingSheet[]> {
  const components = documentSource.componentSources?.() ?? [];
  const generated: DrawingSheet[] = [];
  const generatePart = (source: SheetShapeSource, component?: typeof components[number]) => {
    const hasSheetMetal = source.supportsFlatten;
    const featuresSignature = source.signature;
    const first = generated.length;
    for (const flatten of (hasSheetMetal ? [true, false] : [false])) {
      const bends:import("@/lib/replicad/drawingBends").NativeDrawingBend[]=[];
      const shape = source.buildShape({flatten,onBend:b=>bends.push(b)});
      if (!shape) throw new Error(source.emptyMessage);
      try {
        const sheet = createSheetObject(hasSheetMetal ? (flatten ? "Chapa · Planificada" : "Chapa · Dobrada") : "Cotagem automática");
        sheet.size = "A3"; sheet.orientation = "landscape";
        if (titleBlock) sheet.titleBlock = JSON.parse(JSON.stringify(titleBlock));
        sheet.titleBlock.page = `${generated.length+1}/${hasSheetMetal ? 2 : 1}`;
        const orthogonal = (["front", "top", "right"] as const).map(o => buildDrawingView(shape,o,flatten,{bends}));
        // Place the broadest projection first: flat stock is not always modelled on XY.
        orthogonal.sort((a,b)=>b.box.width*b.box.height-a.box.width*a.box.height);
        const views = flatten ? [orthogonal[0], buildDrawingView(shape,"iso",true)] : [...orthogonal,buildDrawingView(shape,"iso",false)];
        // On the bent sheet, keep the isometric above the bend schedule.
        // Orthogonal views occupy the left side, leaving room for their dimensions.
        const cells = flatten
          ? [{x:115,y:125,w:155,h:170},{x:310,y:125,w:135,h:150}]
          : source.bends?.length
            ? [{x:75,y:70,w:95,h:65},{x:200,y:70,w:95,h:65},{x:115,y:185,w:155,h:65},{x:335,y:75,w:105,h:85}]
            : [{x:115,y:70,w:155,h:65},{x:310,y:70,w:135,h:65},{x:115,y:185,w:155,h:65},{x:310,y:185,w:135,h:65}];
        const scale = Math.min(...views.map((v,i)=>Math.min(1,cells[i].w/Math.max(v.box.width,1),cells[i].h/Math.max(v.box.height,1))));
        sheet.scale = scale;
        sheet.views = views.map((v,i)=>({...v,x:cells[i].x,y:cells[i].y,scale,scaleLabel:scaleToLabel(scale),label:VIEW_ORIENTATION_LABELS[v.orientation],sourceSignature:featuresSignature}));
        sheet.dimensions = sheet.views.flatMap(v=>[...autoDimensions(v,autoDetails),...bendAngles(v,(source.bends??[]).map(b=>b.angle))]);
        sheet.annotations = sheet.views.flatMap(v=>[...autoCircleNotes(v),...autoRadiusNotes(v)]);
        if (!flatten && source.bends?.length) {
          sheet.annotations.push(...bendSchedule(source.bends.slice(0, 14)));
        }
        generated.push(sheet);
      } finally { shape.delete(); }
    }
    if (source.bends && source.bends.length > 14) {
      for (let start=14; start<source.bends.length; start+=30) {
        const extra=createSheetObject(`Dobras · Continuação ${Math.floor((start-14)/30)+1}`);
        extra.size="A3"; extra.orientation="landscape";
        if(titleBlock) extra.titleBlock=JSON.parse(JSON.stringify(titleBlock));
        extra.annotations=bendSchedule(source.bends.slice(start,start+30),20,30);
        generated.push(extra);
      }
    }
    for (const sheet of generated.slice(first)) {
      if (component) {
        sheet.sourceInstanceId = component.id;
        sheet.name = `${component.name} · ${sheet.name}`;
        sheet.titleBlock.partName = component.properties.description || component.name;
        sheet.titleBlock.code = component.properties.partNumber;
        sheet.titleBlock.material = component.properties.material;
      }
    }
  };
  if (documentSource.componentSources) {
    const unavailable = components.filter(c => !c.available);
    if (unavailable.length) throw new Error(`Resolva as peças antes de gerar: ${unavailable.map(c => c.name).join(", ")}.`);
    generatePart(documentSource);
    const assembly = generated[0];
    assembly.name = "Montagem · Lista de materiais";
    const rows = refreshBomRows([], documentSource.bomParts?.() ?? []);
    // Reserve the right half for the BOM; assembly reference views stay on the left.
    assembly.views = assembly.views.filter(v => v.orientation === "iso" || v.id === assembly.views[0].id);
    assembly.views.forEach((v,i) => {
      v.x = 105; v.y = i ? 180 : 70;
      v.scale = Math.min(1, 150/Math.max(v.box.width,1), 65/Math.max(v.box.height,1));
      v.scaleLabel = scaleToLabel(v.scale);
    });
    assembly.dimensions = assembly.views.flatMap(v => autoDimensions(v, autoDetails));
    assembly.annotations = assembly.views.flatMap(v => [...autoCircleNotes(v), ...autoRadiusNotes(v)]);
    for (let start=0; start<rows.length; start+=25) {
      const sheet = start === 0 ? assembly : createSheetObject(`Lista de materiais · ${start/25+1}`);
      sheet.size="A3"; sheet.orientation="landscape";
      if (start) { sheet.titleBlock = {...assembly.titleBlock}; generated.push(sheet); }
      const table = createBomTable(220, 245, rows.slice(start,start+25));
      table.rowRange = {start, count:25};
      const ratio = Math.min(1, 185/bomTableWidth(table));
      table.columns = table.columns.map(c => ({...c,width:c.width*ratio}));
      sheet.bomTables = [table];
    }
    const groups = new Set<string>();
    for (const component of components) {
      if (groups.has(component.group)) continue;
      groups.add(component.group);
      await new Promise(resolve => setTimeout(resolve, 0));
      const item = rows.find(row => row.instanceIds.includes(component.id))?.values.item;
      generatePart(component.source, {...component, name: `Item ${item ?? "—"} · ${component.name}`});
    }
  } else generatePart(documentSource);
  generated.forEach((sheet,index)=>{sheet.titleBlock.page=`${index+1}/${generated.length}`;});
  return generated.map(layoutLeaders);
}

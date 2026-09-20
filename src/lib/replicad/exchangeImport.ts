import { importSTEP, importSTL, isShape3D, getOC, measureVolume } from "replicad";
import type { ImportedFeature } from "@/lib/features/types";

/** Import once, then persist BREP so the synchronous feature rebuild can reopen it. */
export async function importBody(file: Blob, name: string, id: string): Promise<ImportedFeature> {
  const extension=name.split('.').at(-1)?.toLowerCase();
  if(!['step','stp','stl'].includes(extension??''))throw new Error('Escolha um arquivo STEP ou STL.');
  if(file.size>50*1024*1024)throw new Error('Importação limitada a 50 MB por arquivo.');
  const shape=extension==='stl'?await importSTL(file):await importSTEP(file);
  try {
    if(!isShape3D(shape))throw new Error('O arquivo não contém um corpo 3D.');
    const oc=getOC(),check=new oc.BRepCheck_Analyzer(shape.wrapped,true,false);
    try {if(!check.IsValid_2())throw new Error('Corpo inválido; repare o arquivo antes de importar.');}
    finally {check.delete();}
    if(measureVolume(shape)<=1e-9)throw new Error('Importe um corpo fechado com volume positivo.');
    return {id,type:'imported',label:name,format:extension==='stl'?'stl':'step',brep:shape.serialize()};
  } finally {shape.delete();}
}

export type BodyImportResult = { features: ImportedFeature[]; warnings: string[] };

/** Convert a whole exchange document before publishing any changes to the store. */
export async function importBodies(
  file: Blob, name: string, createId: () => string, options: { glbScale?: number } = {},
): Promise<BodyImportResult> {
  const extension = name.split(".").at(-1)?.toLowerCase();
  if (extension === "ipt" || extension === "iam") {
    throw new Error("IPT/IAM não têm leitor direto neste aplicativo. No Inventor, exporte a peça ou montagem para STEP e importe o STEP aqui. O IAM precisa das peças referenciadas para a exportação.");
  }
  if (!["step", "stp", "ste", "stl", "glb"].includes(extension ?? "")) throw new Error("Escolha STEP, STL ou GLB.");
  if (file.size > 50 * 1024 * 1024) throw new Error("Importação limitada a 50 MB por arquivo.");
  const features: ImportedFeature[] = [];
  const warnings = ["Conversão em corpos base: esboços, cotas e operações originais não são reconstruídos. Salve como .eks3d para continuar editando."];
  const { cast, iterTopo } = await import("replicad");
  const appendSolids = (shape: Awaited<ReturnType<typeof importSTEP>>, label: string, format: ImportedFeature["format"], nodePath?: string) => {
    // Drain the iterator before validation so its OpenCascade explorer is disposed even on failure.
    const rawSolids = Array.from(iterTopo(shape.wrapped, "solid"));
    try {
      if (!rawSolids.length) throw new Error(`${label}: não contém sólidos fechados.`);
      if (features.length + rawSolids.length > 200) throw new Error("Importação limitada a 200 corpos.");
      for (const raw of rawSolids) {
        const solid = cast(raw);
        try {
          if (!isShape3D(solid)) throw new Error(`${label}: entidade não sólida.`);
          const check = new (getOC().BRepCheck_Analyzer)(solid.wrapped, true, false);
          try { if (!check.IsValid_2()) throw new Error(`${label}: corpo inválido; repare a geometria antes de importar.`); }
          finally { check.delete(); }
          const volume = measureVolume(solid);
          if (!Number.isFinite(volume) || volume <= 1e-9) throw new Error(`${label}: corpo aberto, invertido ou sem volume positivo.`);
          features.push({
            id: createId(), type: "imported", format, brep: solid.serialize(), preserveBody: true,
            label: `${label} · Corpo ${features.length + 1}`,
            source: { fileName: name, bodyIndex: features.length, ...(nodePath ? { nodePath } : {}), ...(format === "glb" ? { millimetresPerUnit: options.glbScale ?? 1000 } : {}) },
          });
        } finally { solid.delete(); }
      }
    } finally { for (const raw of rawSolids) raw.delete(); }
  };
  if (extension === "glb") {
    const { readGLBBodies } = await import("./glbImport");
    const bodies = await readGLBBodies(file, options.glbScale ?? 1000);
    for (const body of bodies) {
      let shape: Awaited<ReturnType<typeof importSTL>>;
      try { shape = await importSTL(body.stl); }
      catch { throw new Error(`${body.path}: não foi possível converter a malha em sólido; repare e feche a malha antes de importar.`); }
      try { appendSolids(shape, body.path, "glb", body.path); }
      finally { shape.delete(); }
    }
    warnings.push("GLB: cena estática convertida de Y-up para Z-up; curvas permanecem facetadas. Materiais, texturas e animações não são importados.");
  } else {
    const shape = extension === "stl" ? await importSTL(file) : await importSTEP(file);
    try { appendSolids(shape, name, extension === "stl" ? "stl" : "step"); }
    finally { shape.delete(); }
    if (extension !== "stl") warnings.push("STEP: corpos e posições preservados; nomes, hierarquia e vínculos da montagem original não são recuperados por este leitor.");
  }
  return { features, warnings };
}

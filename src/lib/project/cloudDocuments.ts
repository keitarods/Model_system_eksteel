import { parseDrawing } from "@/lib/drawing/documentFormat";
import type { SupabaseClient } from '@supabase/supabase-js';
import { cloudName, MAX_PROJECT_BYTES, storageSegment } from './cloudStorage';
import { parseProject } from './nativeFormat';
import { parseAssembly } from './assemblyFormat';
export type CloudDocument = { id: string; owner_id: string; folder_name: string; source_name: string; filename: string; kind: 'part'|'assembly'|'drawing'|'pdf'|'dxf'; object_path: string; byte_size: number; created_at: string; purpose: string };
export interface DocumentLibrary {
  list(folder: string): Promise<CloudDocument[]>;
  upload(folder: string, source: string, filename: string, body: Blob, purpose: string): Promise<void>;
  download(document: CloudDocument): Promise<Blob>;
}
export async function validateDocument(filename: string, body: Blob): Promise<CloudDocument['kind']> {
  if (!body.size || body.size > MAX_PROJECT_BYTES) throw new Error('Arquivo vazio ou acima de 50 MiB.');
  cloudName(filename);
  const ext=filename.toLowerCase().split('.').pop();
  if(ext==='pdf') { if(!(await body.slice(0,5).text()).startsWith('%PDF-')) throw new Error('PDF inválido.'); return 'pdf'; }
  if(ext==='dxf') { const text=await body.text(); if(!/\bSECTION\b/.test(text)||! /\bEOF\b/.test(text)) throw new Error('Use um DXF ASCII válido.'); return 'dxf'; }
  if(ext==='eksdesenho') { parseDrawing(await body.text()); return 'drawing'; }
  if(ext==='eks3d') { parseProject(await body.text()); return 'part'; }
  if(ext==='eks3dasm') {
    const doc=parseAssembly(await body.text());
    if(doc.instances.some(i=>!i.embeddedPart)) throw new Error('Esta montagem depende de arquivos locais. Abra-a no ambiente Montagem e use Salvar montagem nesta pasta para incluir as peças.');
    for(const instance of doc.instances) parseProject(instance.embeddedPart!);
    return 'assembly';
  }
  throw new Error('Formatos aceitos: .eks3d, .eks3dasm portátil, .eksdesenho, .pdf e .dxf ASCII.');
}
export function createDocumentLibrary(client: SupabaseClient, owner: string): DocumentLibrary {
  const bucket=client.storage.from('cad-documents');
  function check(error: {message:string}|null) { if(error) throw new Error(`Biblioteca: ${error.message}. Verifique a migração de documentos e as permissões.`); }
  return {
    async list(folder) {
      const all:CloudDocument[]=[];
      for(let offset=0;;offset+=100) {
        const {data,error}=await client.from('eksteel_cad_documents').select('*').eq('folder_name',cloudName(folder)).order('created_at',{ascending:false}).order('id').range(offset,offset+99);
        check(error); all.push(...(data ?? []) as CloudDocument[]);if(!data||data.length<100)return all;
      }
    },
    async upload(folder,source,filename,body,purpose) {
      const kind=await validateDocument(filename,body);
      const id=crypto.randomUUID();
      const name=cloudName(filename); const folderName=cloudName(folder); const sourceName=cloudName(source);
      if(purpose.length>500)throw new Error('A observação deve ter até 500 caracteres.');
      const object_path=`${owner}/${storageSegment(folderName)}/${id}/${storageSegment(name)}`;
      // Generic binary MIME preserves files exactly; allowed types are validated by the app.
      const {error:uploadError}=await bucket.upload(object_path,body,{upsert:false,contentType:'application/octet-stream'});check(uploadError);
      const {error}=await client.from('eksteel_cad_documents').insert({id,owner_id:owner,folder_name:folderName,source_name:sourceName,filename:name,kind,object_path,byte_size:body.size,purpose});
      if(error) throw new Error('O arquivo foi enviado, mas não foi possível registrar o catálogo. Ele ainda não está publicado para o Gestão; peça ao administrador para verificar o objeto sem catálogo antes de reenviar.');
    },
    async download(document) {
      const {data,error}=await bucket.download(document.object_path);check(error);
      if(!data)throw new Error('Documento não encontrado.');
      if(data.size>MAX_PROJECT_BYTES)throw new Error('Arquivo acima de 50 MiB.');
      return data;
    },
  };
}

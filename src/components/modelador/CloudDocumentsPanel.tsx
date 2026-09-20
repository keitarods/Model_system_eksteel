"use client";
import { useExportQueue } from "@/lib/project/exportQueue";
import { useState } from 'react';
import type { CloudDocument, DocumentLibrary } from '@/lib/project/cloudDocuments';
export function CloudDocumentsPanel({library,folder,source,busy,run,getNative,onOpenNative,nativeExtension,generateDocument}: {
 library:DocumentLibrary;folder:string;source:string;busy:boolean;run:(action:()=>Promise<void>)=>Promise<void>;
 getNative:()=>string|Promise<string>;onOpenNative:(json:string,name:string)=>void;nativeExtension:'.eks3d'|'.eks3dasm'|'.eksdesenho';
 generateDocument?:(kind:'pdf'|'dxf')=>Promise<{filename:string;body:Blob}>;
}) {
 const exports=useExportQueue(s=>s.files);
 const [documents,setDocuments]=useState<CloudDocument[]>([]);
 const [purpose,setPurpose]=useState('');const [status,setStatus]=useState('');
 const button='rounded border border-chrome-border px-3 py-2 text-sm disabled:opacity-40';
 async function refresh(){setDocuments(await library.list(folder));}
 return <section className="mt-4 space-y-3 border-t border-chrome-border pt-4">
  <h3 className="font-semibold">Arquivos da pasta — peças, montagens, desenhos, PDF e DXF</h3>
  <p className="text-xs">Origem: {source || 'preencha o nome acima'}. Cada envio preserva uma cópia independente. PDFs e DXFs podem ser consultados pelo Gestão com permissão de leitura.</p>
  <label className="block text-sm">Observação para compras / referência<input disabled={busy} maxLength={500} className="w-full rounded border border-chrome-border bg-chrome-surface-alt p-2" value={purpose} onChange={e=>setPurpose(e.target.value)} /></label>
  <div className="flex flex-wrap gap-2">
   <button type="button" className={button} disabled={busy||!folder||!source.trim()} onClick={()=>void run(async()=>{
    const json=await getNative();await library.upload(folder,source,`${source.replace(/\.(?:eks3d(?:asm)?|eksdesenho)$/i,'')}${nativeExtension}`,new Blob([json]),purpose);
    setStatus('Cópia nativa enviada.');await refresh();
   })}>{nativeExtension==='.eksdesenho'?'Salvar desenho nesta pasta':nativeExtension==='.eks3dasm'?'Salvar montagem nesta pasta':'Salvar arquivo da peça nesta pasta'}</button>
   {generateDocument && (['pdf','dxf'] as const).map(kind=><button key={kind} type="button" className={button} disabled={busy||!folder||!source.trim()} onClick={()=>void run(async()=>{
    const file=await generateDocument(kind);await library.upload(folder,source,file.filename,file.body,purpose);
    setStatus(`${kind.toUpperCase()} gerado e enviado para ${folder}.`);await refresh();
   })}>Gerar e enviar {kind.toUpperCase()}</button>)}
   <label className={button}>Enviar arquivo
    <input className="block max-w-full text-xs" type="file" accept=".pdf,.dxf,.eks3d,.eks3dasm,.eksdesenho" disabled={busy||!folder||!source.trim()} onChange={e=>{
     const file=e.target.files?.[0];e.target.value='';if(!file)return;
     void run(async()=>{await library.upload(folder,source,file.name,file,purpose);setStatus('Arquivo enviado e registrado.');await refresh();});
    }} />
   </label>
   <button type="button" className={button} disabled={busy||!folder} onClick={()=>void run(refresh)}>Atualizar arquivos</button>
  </div>
  {exports.length>0 && <div className="space-y-2"><p className="text-xs">PDFs/DXFs exportados nesta aba — confira a origem antes de enviar:</p>{exports.map(file=><div key={file.id} className="flex flex-wrap items-center gap-2 text-xs">
    <span>{file.filename}</span><button type="button" className={button} disabled={busy||!folder||!source.trim()} onClick={()=>void run(async()=>{
      await library.upload(folder,source,file.filename,file.body,purpose);useExportQueue.getState().remove(file.id);setStatus('Exportação enviada e vinculada à origem informada.');await refresh();
    })}>Enviar para esta pasta</button>
    <button type="button" disabled={busy} onClick={()=>useExportQueue.getState().remove(file.id)}>Dispensar</button>
  </div>)}</div>}
  <p role="status" className="text-xs">{status}</p>
  <ul className="max-h-72 space-y-3 overflow-auto">{documents.map(doc=><li key={doc.id} className="rounded border border-chrome-border p-2 text-sm">
   <p className="break-all font-semibold">{doc.filename}</p><p>{doc.source_name} · {new Date(doc.created_at).toLocaleString()} · {Math.ceil(doc.byte_size/1024)} KiB</p>
   {doc.purpose&&<p>{doc.purpose}</p>}
   <button type="button" disabled={busy} className={button} onClick={()=>void run(async()=>{
    const body=await library.download(doc);const url=URL.createObjectURL(body);const a=document.createElement('a');a.href=url;a.download=doc.filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
   })}>Baixar</button>
   {((doc.kind==='drawing'&&nativeExtension==='.eksdesenho')||(doc.kind==='part'&&nativeExtension==='.eks3d')||(doc.kind==='assembly'&&nativeExtension==='.eks3dasm'))&&<button type="button" disabled={busy} className={button} onClick={()=>void run(async()=>{
    const body=await library.download(doc);if(!window.confirm('Abrir este arquivo? Alterações não salvas serão substituídas.'))return;
    onOpenNative(await body.text(),doc.filename);setStatus('Arquivo aberto.');
   })}>Abrir no software</button>}
  </li>)}</ul>
 </section>;
}

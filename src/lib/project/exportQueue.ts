import { create } from 'zustand';
type ExportedFile = { id:string; filename:string; body:Blob };
/** Last exports in this tab only. No upload without the user's explicit action. */
export const useExportQueue=create<{files:ExportedFile[];add:(filename:string,body:Blob)=>void;remove:(id:string)=>void}>(set=>({
 files:[],
 add:(filename,body)=>{if(!/\.(pdf|dxf)$/i.test(filename)||body.size>50*1024*1024)return;set(s=>({files:[{id:crypto.randomUUID(),filename,body},...s.files].slice(0,5)}));},
 remove:id=>set(s=>({files:s.files.filter(f=>f.id!==id)})),
}));

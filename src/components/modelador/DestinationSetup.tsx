"use client";
import { useState } from 'react';
export function DestinationSetup({host,port,busy,run}: {host:string;port:number;busy:boolean;run:(action:()=>Promise<void>)=>Promise<void>}) {
  const [token,setToken]=useState('');
  const [approved,setApproved]=useState('');
  const [certificate,setCertificate]=useState<{address:string;pem:string;name:string}|null>(null);
  const selected = certificate?.address === `${host.trim().toLowerCase()}:${port}` ? certificate : null;
  const address=`${host.trim().toLowerCase()}:${port}`;
  return <div className="space-y-2 rounded border border-chrome-border p-3 text-sm">
    <p>Autorizar conexão do servidor com <strong>{host ? address : 'o host e a porta preenchidos acima'}</strong></p>
    <label className="block">Token administrativo (dispensado em desenvolvimento local)
      <input type="password" autoComplete="off" disabled={busy} value={token} onChange={e=>setToken(e.target.value)} className="block w-full rounded border border-chrome-border bg-chrome-surface-alt p-2" />
    </label>
    <label className="block">Certificado CA do banco (opcional, PEM .crt/.cer/.pem)
      <input type="file" accept=".crt,.cer,.pem" disabled={busy || !host.trim()} className="block w-full text-sm" onChange={event=>{
        const file=event.target.files?.[0]; event.target.value=''; if (!file) return;
        setApproved(''); setCertificate(null);
        void run(async()=>{
          if(file.size>65536) throw new Error('Certificado CA acima de 64 KiB.');
          const pem=await file.text();
          if(!pem.includes('-----BEGIN CERTIFICATE-----') || pem.includes('PRIVATE KEY')) throw new Error('Use o certificado CA público em formato PEM, sem chave privada.');
          setCertificate({address,pem,name:file.name});
        });
      }} />
    </label>
    {selected && <p>Certificado selecionado: {selected.name} <button type="button" disabled={busy} className="underline" onClick={()=>{setCertificate(null);setApproved('');}}>Cancelar seleção</button></p>}
    <p className="text-xs text-chrome-text-muted">Supabase: Database → Settings → SSL Configuration → baixar certificado CA. Carregar o arquivo e autorizar novamente salva a CA para este host e porta, sem reiniciar. Sem arquivo novo, a CA salva é preservada.</p>
    <button type="button" disabled={busy || !host.trim() || !Number.isInteger(port)} className="rounded border border-chrome-border px-3 py-2 disabled:opacity-40" onClick={()=>void run(async()=>{
      try {
        const response=await fetch('/api/database-destinations',{method:'POST',headers:{'Content-Type':'application/json','X-Setup-Token':token},body:JSON.stringify({host,port,...(selected ? {caPem:selected.pem} : {})})});
        if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Sessão indisponível. Entre novamente no software.');
        const result=await response.json(); if(!response.ok) throw new Error(result.error);
        setApproved(address);
      } finally {setToken('');}
    })}>Autorizar destino</button>
    {approved===address && <p role="status" className="text-emerald-600">Destino autorizado e configuração TLS salva. Agora prepare o banco ou conecte.</p>}
    <p className="text-xs text-chrome-text-muted">A autorização fica salva nesta instalação, sem reiniciar. Não altera o firewall ou as permissões do banco.</p>
  </div>;
}

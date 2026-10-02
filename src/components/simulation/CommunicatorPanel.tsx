'use client';
import {useEffect,useRef,useState} from 'react';
import {requestLocalFeaConnection,disconnectLocalFea,feaConnection,feaRequest,setFeaTarget,type FeaTarget} from '@/lib/simulation/client';

export function CommunicatorPanel({busy,onChange,onBusyChange}:{busy:boolean;onChange:()=>void;onBusyChange:(value:boolean)=>void}){
  const [connection,setConnection]=useState(feaConnection);
  const [pending,setPending]=useState(false),[available,setAvailable]=useState(false);
  const [status,setStatus]=useState('Abra o comunicador. Na primeira conexão, basta aceitar a solicitação.');
  const controller=useRef<AbortController|null>(null);
  const callbacks=useRef({onChange,onBusyChange});callbacks.current={onChange,onBusyChange};
  async function connect(automatic=false){
    if(controller.current)return;
    const current=new AbortController();controller.current=current;
    setPending(true);setAvailable(false);setStatus('Procurando o comunicador neste computador… Se o navegador pedir acesso à rede local, permita para continuar.');callbacks.current.onBusyChange(true);
    try{
      const connected=await requestLocalFeaConnection({automatic,signal:current.signal,onStatus:setStatus});
      if(current.signal.aborted)return;
      setConnection(feaConnection());
      if(connected){callbacks.current.onChange();setStatus('Conectado a este computador.');}
      else setStatus('Clique em Conectar e aceite a solicitação no comunicador. Marque “Lembrar este site” para as próximas visitas.');
    }catch(error){if(!current.signal.aborted)setStatus(error instanceof Error?error.message:'Não foi possível conectar.');}
    finally{if(controller.current===current){controller.current=null;setPending(false);callbacks.current.onBusyChange(false);}}
  }
  useEffect(()=>{
    // Delay allows StrictMode's discarded mount to cancel before any request.
    const timer=setTimeout(()=>{if(feaConnection().target==='local'&&!feaConnection().connected)void connect(true);},0);
    const restore=(event:PageTransitionEvent)=>{if(event.persisted){setConnection(feaConnection());if(feaConnection().target==='local')void connect(true);}};
    const leave=()=>controller.current?.abort();
    window.addEventListener('pageshow',restore);window.addEventListener('pagehide',leave);
    return()=>{clearTimeout(timer);controller.current?.abort();window.removeEventListener('pageshow',restore);window.removeEventListener('pagehide',leave);};
  },[]);
  useEffect(()=>{
    let live=true;
    async function check(){
      if(connection.target==='local'&&!connection.connected){setAvailable(false);return;}
      try{const health=await feaRequest();if(live){setAvailable(health.ready===true);setStatus(health.ready?'Pronto para gerar malhas e calcular.':'O comunicador está aberto, mas o motor de cálculo não está disponível.');}}
      catch(error){if(live){setAvailable(false);setStatus(error instanceof Error?error.message:'Executor indisponível.');}}
    }
    if(!pending)void check();const timer=setInterval(()=>{if(!busy&&!pending)void check();},30000);
    return()=>{live=false;clearInterval(timer);};
  },[connection,busy,pending]);
  async function change(action:()=>Promise<void>){
    setPending(true);onBusyChange(true);setAvailable(false);
    try{await action();setConnection(feaConnection());onChange();setStatus('Conexão atualizada.');}
    catch(error){setStatus(error instanceof Error?error.message:'Não foi possível alterar a conexão.');}
    finally{setPending(false);onBusyChange(false);}
  }
  return <details className="shrink-0 border-b border-chrome-border bg-chrome-bg px-3 py-2 text-xs text-chrome-text" open={!connection.connected&&connection.target==='local'}>
    <summary className="cursor-pointer font-semibold">Cálculo: {connection.target==='local'?'neste computador':'servidor da instalação'} · {available?'Conectado':pending?'Conectando…':'Desconectado'}</summary>
    <fieldset disabled={busy||pending} className="mt-2 flex flex-wrap items-end gap-3 disabled:opacity-60">
      <label>Executar em<select className="ml-2 rounded border bg-white px-2 py-1 text-slate-800" value={connection.target} onChange={e=>void change(()=>setFeaTarget(e.target.value as FeaTarget))}><option value="local">Meu computador</option><option value="server">Servidor da instalação</option></select></label>
      {connection.target==='local'&&<>
        <p className="basis-full">Abra o aplicativo Eksteel Comunicador no seu computador e aguarde a mensagem “Pronto”. Depois clique em Conectar e aceite a janela de autorização. Este botão conecta ao aplicativo já aberto.</p>
        <button className="rounded border px-3 py-1" onClick={()=>void connect()}>Conectar ao meu computador</button>
        {connection.connected&&<button className="rounded border px-3 py-1" onClick={()=>void change(disconnectLocalFea)}>Desconectar</button>}
        <p className="basis-full">No comunicador, marque “Abrir automaticamente ao entrar no Windows/Linux” e, ao autorizar, “Lembrar este site” para facilitar as próximas conexões. O navegador também poderá pedir permissão de acesso local.</p>
      </>}
    </fieldset>
    {pending&&controller.current&&<button className="mt-2 rounded border px-3 py-1" onClick={()=>{controller.current?.abort();setStatus('Solicitação cancelada.');}}>Cancelar conexão</button>}
    <p role="status" className="mt-2">{status}</p>
  </details>;
}

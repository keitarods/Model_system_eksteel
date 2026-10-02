export type FeaTarget = 'local'|'server';
const LOCAL_URL='http://127.0.0.1:8091';
let target:FeaTarget='local';
let localToken:string|null=null;
type Transport={target:FeaTarget;token:string|null};
const snapshot=():Transport=>({target,token:localToken});
export function feaConnection(){return {target,connected:target==='local'&&!!localToken};}

function localPath(path:string,method:string){
  const params=new URLSearchParams(path.replace(/^\?/,''));
  const id=params.get('jobId');
  if(method==='POST')return '/jobs';
  if(!id){if(method==='DELETE')throw new Error('Trabalho inválido.');return '/health';}
  if(!/^[a-f0-9-]{36}$/.test(id))throw new Error('Trabalho inválido.');
  return `/jobs/${id}${params.has('result')?'/result':params.has('input')?'/input':''}`;
}
async function transportFetch(connection:Transport,path='',init?:RequestInit){
  const headers=new Headers(init?.headers);
  headers.set('Content-Type','application/json');
  let url=`/api/simulation${path}`;
  if(connection.target==='local'){
    if(!connection.token)throw new Error('Abra o comunicador e aceite a solicitação de conexão deste site.');
    url=LOCAL_URL+localPath(path,init?.method??'GET');
    headers.set('Authorization',`Bearer ${connection.token}`);
  }
  try{
    return await fetch(url,{...init,headers,credentials:connection.target==='local'?'omit':'same-origin',cache:'no-store',redirect:'error',signal:init?.signal??AbortSignal.timeout(30000)});
  }catch(error){
    if(connection.target==='local'&&!(error instanceof Error&&error.name==='AbortError'))throw new Error('Comunicador local indisponível. Abra o aplicativo e permita o acesso à rede local nas permissões do navegador.');
    throw error;
  }
}
async function requestWith(connection:Transport,path='',init?:RequestInit){
  const response=await transportFetch(connection,path,init);
  let body;
  try{body=await response.json();}catch{throw new Error('Resposta inválida do serviço de cálculo.');}
  if(!response.ok)throw new Error(body.error??body.detail??'Erro no serviço de simulação.');
  return body;
}
/** Ask the desktop app for approval. The browser never grants its own trust. */
export async function requestLocalFeaConnection({automatic=false,signal,onStatus}:{automatic?:boolean;signal?:AbortSignal;onStatus?:(message:string)=>void}={}){
  let requestId:string|undefined,requestToken:string|undefined,connected=false;
  async function call(path:string,init:RequestInit={}){
    let response:Response;
    try{response=await fetch(LOCAL_URL+path,{...init,credentials:'omit',cache:'no-store',redirect:'error',signal:init.signal?AbortSignal.any([init.signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000)});}
    catch(error){if(error instanceof Error&&error.name==='AbortError')throw error;throw new Error('Não foi possível alcançar o comunicador neste computador. Abra o aplicativo Eksteel Comunicador pelo menu do Windows/Linux, aguarde “Pronto” e tente conectar novamente. Se ele já estiver aberto, verifique a permissão de acesso à rede local deste site no navegador.');}
    const body=await response.json();
    if(!response.ok)throw new Error(body.detail??'Não foi possível solicitar a conexão. Atualize o comunicador.');
    return body;
  }
  const aborted=()=>{if(signal?.aborted)throw new DOMException('Cancelado','AbortError');};
  try{
    aborted();
    // Obtain the request id even if the user cancels while the POST is in flight.
    const request=await call('/connect',{method:'POST',headers:{'X-Eksteel-Connect':automatic?'automatic':'request'}});
    if(request.status==='approval_required')return false;
    if(!/^[a-f0-9]{32}$/.test(request.id??'')||!/^[A-Za-z0-9_-]{32}$/.test(request.requestToken??''))throw new Error('Resposta incompatível. Atualize o comunicador.');
    requestId=request.id;requestToken=request.requestToken;
    const deadline=Date.now()+120000;
    while(Date.now()<deadline){
      aborted();
      const result=await call(`/connect/${requestId}`,{headers:{'X-Eksteel-Request':requestToken!},signal});
      aborted();
      if(result.status==='approved'){
        if(result.protocol!==2||!/^[A-Za-z0-9_-]{43}$/.test(result.token??''))throw new Error('Versão do comunicador incompatível.');
        await disconnectLocalFea();aborted();target='local';localToken=result.token;connected=true;return true;
      }
      if(result.status==='denied'||result.status==='cancelled')throw new Error(result.detail??'Conexão recusada no comunicador.');
      if(result.status!=='pending')throw new Error('Resposta inválida do comunicador.');
      onStatus?.('Aceite a solicitação na janela do Eksteel Comunicador.');
      await new Promise<void>((resolve,reject)=>{
        const abort=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(new DOMException('Cancelado','AbortError'));};
        const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},500);
        signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
      });
    }
    throw new Error('A solicitação expirou. Clique em Conectar para tentar novamente.');
  }finally{
    if(!connected&&requestId&&requestToken){
      try{await fetch(`${LOCAL_URL}/connect/${requestId}`,{method:'DELETE',headers:{'X-Eksteel-Request':requestToken},credentials:'omit',cache:'no-store',redirect:'error',keepalive:true,signal:AbortSignal.timeout(5000)});}catch{/* Pending approvals expire on the desktop after two minutes. */}
    }
  }
}

export async function connectLocalFea(code:string){
  if(!/^[A-Za-z0-9_-]{32}$/.test(code.trim()))throw new Error('Copie o código de 32 caracteres exibido no comunicador.');
  let response:Response;
  try{
    response=await fetch(`${LOCAL_URL}/pair`,{method:'POST',headers:{'X-Eksteel-Pairing':code.trim()},credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});
  }catch{throw new Error('Não foi possível conectar. Abra o comunicador, autorize o endereço deste site e permita o acesso local no navegador.');}
  const body=await response.json();
  if(!response.ok)throw new Error(body.detail??'Conexão local recusada.');
  if(body.protocol!==1||typeof body.token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(body.token))throw new Error('Versão do comunicador incompatível.');
  await disconnectLocalFea();
  target='local';localToken=body.token;
}
export async function disconnectLocalFea(){
  const previous=localToken;localToken=null;
  if(previous){
    try{await fetch(`${LOCAL_URL}/disconnect`,{method:'DELETE',headers:{Authorization:`Bearer ${previous}`},keepalive:true,credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(5000)});}catch{/* The desktop app can also revoke every session. */}
  }
}
export async function setFeaTarget(next:FeaTarget){await disconnectLocalFea();target=next;}
export async function feaRequest(path='',init?:RequestInit){return requestWith(snapshot(),path,init);}
export async function feaInput(id:string){
  const response=await transportFetch(snapshot(),`?jobId=${id}&input=1`);
  if(!response.ok)throw new Error('Entrada indisponível. Recalcule o estudo.');
  return response.text();
}
export type FeaProgress={percent:number|null;stage:string};
export async function runFeaJob(payload:unknown,signal:AbortSignal,onJob:(id:string)=>void,onStatus:(status:string)=>void,onProgress?:(progress:FeaProgress)=>void){
  onProgress?.({percent:null,stage:'Enviando solicitação…'});
  // Freeze the transport for the whole job, including cancellation. Never send
  // an existing id or geometry to a different executor after a mode change.
  const connection=snapshot();
  if(signal.aborted)throw new DOMException('Cancelado','AbortError');
  const job=await requestWith(connection,'',{method:'POST',body:JSON.stringify(payload)});
  onJob(job.id);
  const cancel=()=>{void requestWith(connection,`?jobId=${job.id}`,{method:'DELETE',keepalive:true}).catch(()=>{});};
  signal.addEventListener('abort',cancel,{once:true});
  try{
    if(signal.aborted){cancel();throw new DOMException('Cancelado','AbortError');}
    for(;;){
      const status=await requestWith(connection,`?jobId=${job.id}`,{signal});
      onProgress?.({percent:typeof status.progress?.percent==='number'&&Number.isFinite(status.progress.percent)?Math.max(0,Math.min(99,status.progress.percent)):null,stage:status.progress?.stage??(status.status==='queued'?'Na fila de cálculo…':'Processando no comunicador…')});
      onStatus(status.status==='queued'?'Na fila de cálculo…':'Processando…');
      if(status.status==='completed'){onProgress?.({percent:99,stage:'Recebendo resultados…'});const result=await requestWith(connection,`?jobId=${job.id}&result=1`,{signal});onProgress?.({percent:100,stage:'Resultados recebidos'});return result;}
      if(status.status==='failed'||status.status==='cancelled')throw new Error(status.error??'Trabalho cancelado.');
      await new Promise<void>((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(new DOMException('Cancelado','AbortError'));};const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},1000);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});
    }
  }finally{signal.removeEventListener('abort',cancel);}
}

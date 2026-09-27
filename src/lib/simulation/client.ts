export async function feaRequest(path='',init?:RequestInit){
  const response=await fetch(`/api/simulation${path}`,{...init,headers:{'Content-Type':'application/json',...init?.headers},redirect:'error'});
  let body;
  try{body=await response.json();}catch{throw new Error('Resposta inválida do serviço. Confira a sessão e a configuração FEA.');}
  if(!response.ok)throw new Error(body.error??body.detail??'Erro no serviço de simulação.');
  return body;
}
export async function runFeaJob(payload:unknown,signal:AbortSignal,onJob:(id:string)=>void,onStatus:(status:string)=>void){
  // Finish obtaining the id even when the user cancels the submission: otherwise
  // the server could retain an untracked CPU-intensive job.
  const job=await feaRequest('',{method:'POST',body:JSON.stringify(payload)});
  onJob(job.id);
  const cancel=()=>{void feaRequest(`?jobId=${job.id}`,{method:'DELETE'}).catch(()=>{});};
  signal.addEventListener('abort',cancel,{once:true});
  try{
    if(signal.aborted){cancel();throw new DOMException('Cancelado','AbortError');}
    for(;;){
      const status=await feaRequest(`?jobId=${job.id}`,{signal});
      onStatus(status.status==='queued'?'Na fila de cálculo…':'Processando…');
      if(status.status==='completed')return await feaRequest(`?jobId=${job.id}&result=1`,{signal});
      if(status.status==='failed'||status.status==='cancelled')throw new Error(status.error??'Trabalho cancelado.');
      await new Promise<void>((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(new DOMException('Cancelado','AbortError'));};const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},1000);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});
    }
  }finally{signal.removeEventListener('abort',cancel);}
}

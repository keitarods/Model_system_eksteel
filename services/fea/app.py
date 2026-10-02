"""Private asynchronous FEA service. Expose only to the Next.js server."""
import hmac
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import FileResponse

TOKEN=os.environ.get('FEA_API_TOKEN','')
ROOT=Path(os.environ.get('FEA_JOB_DIR', tempfile.gettempdir()+'/eksteel-fea-jobs'))
ROOT.mkdir(parents=True,exist_ok=True)
JOBS={}
LOCK=threading.RLock()
POOL=ThreadPoolExecutor(max_workers=1)
TTL=24*3600


def invalid_constant(value):
    raise ValueError('Número não finito.')


def authorize(request):
    if getattr(request.app.state, 'local_authority', None) is not None:
        owner = getattr(request.state, 'local_owner', None)
        if not owner: raise HTTPException(401, 'Conexão local não autorizada.')
        return owner
    if len(TOKEN)<24:
        raise HTTPException(503,'Configure FEA_API_TOKEN com pelo menos 24 caracteres.')
    if not hmac.compare_digest(request.headers.get('authorization',''),f'Bearer {TOKEN}'):
        raise HTTPException(401,'Acesso negado.')
    owner=request.headers.get('x-fea-owner','')
    if not re.fullmatch(r'[a-f0-9]{64}',owner):
        raise HTTPException(401,'Usuário inválido.')
    return owner


def find_job(job_id,owner):
    with LOCK:
        job=JOBS.get(job_id)
        if not job or job['owner']!=owner:
            raise HTTPException(404,'Estudo expirado ou indisponível. Gere a malha novamente.')
        return job


def terminate(job):
    process=job.get('process')
    if process and process.poll() is None:
        try:
            if os.name == 'nt':
                subprocess.run(['taskkill','/PID',str(process.pid),'/T','/F'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW, timeout=10)
                if process.poll() is None: process.kill()
            else:
                os.killpg(process.pid,signal.SIGKILL)
        except ProcessLookupError: pass
        except (OSError,subprocess.SubprocessError):
            if process.poll() is None:process.kill()


def cancel_owner(owner):
    with LOCK:
        for job in JOBS.values():
            if job['owner']==owner and job['status'] in ('queued','running'):
                job['status']='cancelled';terminate(job)


def run(job):
    with LOCK:
        if job['status']=='cancelled': return
        job['status']='running'
        with (job['folder']/'worker.log').open('w') as log:
            job['process']=subprocess.Popen(([sys.executable,'--worker',str(job['folder'])] if getattr(sys,'frozen',False) else [sys.executable,str(Path(__file__).with_name('worker.py')),str(job['folder'])]),stdout=log,stderr=subprocess.STDOUT,start_new_session=os.name!='nt',creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0,env={**os.environ,'OPENBLAS_NUM_THREADS':'1','OMP_NUM_THREADS':'1'})
    try:
        code=job['process'].wait(timeout=240)
        with LOCK:
            if job['status']=='cancelled': return
            if code!=0 or not (job['folder']/'result.json').exists():
                error=job['folder']/'error.txt'
                job['error']=error.read_text()[:1000] if error.exists() else 'Processamento interrompido por limite de recursos ou erro nativo.'
                job['status']='failed'
            else:
                job['status']='completed'
    except subprocess.TimeoutExpired:
        with LOCK:
            terminate(job)
            if job['status']!='cancelled':
                job['status']='failed';job['error']='Tempo limite de 240 segundos excedido. Use uma malha mais grossa.'
    finally:
        job.pop('process',None)


@asynccontextmanager
async def lifespan(app):
    yield
    with LOCK:
        for job in JOBS.values(): terminate(job)
    POOL.shutdown(wait=False,cancel_futures=True)


app=FastAPI(title='Eksteel FEA',docs_url=None,redoc_url=None,lifespan=lifespan)


@app.get('/health')
def health(request:Request):
    authorize(request)
    import importlib.util
    gmsh=importlib.util.find_spec('gmsh') is not None
    ccx=shutil.which(os.environ.get('CCX_BIN','ccx')) is not None
    return {'ready':gmsh and ccx,'gmsh':gmsh,'calculix':ccx,'maxNodes':30000,'maxElements':100000,'assemblyBonded':True}


@app.post('/jobs',status_code=202)
async def create_job(request:Request):
    owner=authorize(request)
    chunks=[];size=0
    async for chunk in request.stream():
        size+=len(chunk)
        if size>14_000_000: raise HTTPException(413,'Geometria acima do limite.')
        chunks.append(chunk)
    try:
        payload=json.loads(b''.join(chunks), parse_constant=invalid_constant)
    except (ValueError,UnicodeDecodeError): raise HTTPException(400,'JSON inválido.')
    if not isinstance(payload,dict) or payload.get('action') not in ('mesh','solve'):
        raise HTTPException(400,'Operação inválida.')
    with LOCK:
        now=time.time()
        for key,job in list(JOBS.items()):
            if now-job['created']>TTL and job['status'] not in ('queued','running'):
                shutil.rmtree(job['folder'],ignore_errors=True);del JOBS[key]
        if len(JOBS)>=100 or sum(j['status'] in ('queued','running') for j in JOBS.values())>=4:
            raise HTTPException(429,'Fila ocupada. Aguarde uma análise terminar.')
        if sum(j['owner']==owner and j['status'] in ('queued','running') for j in JOBS.values())>=2:
            raise HTTPException(429,'Você já possui dois trabalhos pendentes.')
        if payload['action']=='solve':
            if not isinstance(payload.get('meshId'),str): raise HTTPException(400,'Trabalho de malha inválido.')
            source=find_job(payload['meshId'],owner)
            if source['status']!='completed' or source['action']!='mesh':
                raise HTTPException(409,'Gere uma malha válida antes de resolver.')
            if not isinstance(payload.get('study'),dict): raise HTTPException(400,'Estudo inválido.')
            source['created']=now
            payload={'action':'solve','meshFolder':str(source['folder']),'study':payload['study']}
        else:
            mode=payload.get('geometryMode','part')
            if mode not in ('part','assemblyBonded'): raise HTTPException(400,'Tipo de geometria inválido.')
            payload={k:payload[k] for k in ('action','step','size','refinements','preparation','meshControls','elementType','materialMode') if k in payload}
            payload['geometryMode']=mode
            if not isinstance(payload.get('step'),str) or 'ISO-10303-21;' not in payload['step']:
                raise HTTPException(400,'Geometria STEP inválida.')
        job_id=str(uuid.uuid4());folder=ROOT/job_id;folder.mkdir()
        (folder/'request.json').write_text(json.dumps(payload,allow_nan=False))
        job={'id':job_id,'owner':owner,'action':payload['action'],'status':'queued','created':now,'folder':folder}
        JOBS[job_id]=job
        POOL.submit(run,job)
    return {'id':job_id,'status':'queued'}


@app.get('/jobs/{job_id}')
def status(job_id:str,request:Request):
    job=find_job(job_id,authorize(request))
    response={k:job.get(k) for k in ('id','action','status','error')}
    try:
        progress=json.loads((job['folder']/'progress.json').read_text())
        if isinstance(progress.get('percent'),(int,float)) and 0<=progress['percent']<=100 and isinstance(progress.get('stage'),str):
            response['progress']=progress
    except (OSError,ValueError,AttributeError):pass
    if job['status']=='queued':response['progress']={'percent':0,'stage':'Na fila de cálculo'}
    if job['status']=='completed':response['progress']={'percent':100,'stage':'Cálculo concluído'}
    return response


@app.delete('/jobs/{job_id}')
def cancel(job_id:str,request:Request):
    job=find_job(job_id,authorize(request))
    with LOCK:
        if job['status'] in ('queued','running'):
            job['status']='cancelled';terminate(job)
    return {'status':job['status']}


@app.get('/jobs/{job_id}/result')
def result(job_id:str,request:Request):
    job=find_job(job_id,authorize(request))
    if job['status']!='completed': raise HTTPException(409,'Resultado indisponível.')
    return FileResponse(job['folder']/'result.json',media_type='application/json')


@app.get('/jobs/{job_id}/input')
def deck(job_id:str,request:Request):
    job=find_job(job_id,authorize(request))
    if job['status']!='completed' or job['action']!='solve': raise HTTPException(409,'Arquivo indisponível.')
    return FileResponse(job['folder']/'analysis.inp',media_type='text/plain',filename='analysis.inp')

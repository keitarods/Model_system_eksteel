"""Start the local solver with the same server-only configuration as Next.js."""
import os
import sys
from pathlib import Path
root=Path(__file__).resolve().parents[2]
for name in ('.env.local','.env'):
    path=root/name
    if path.exists():
        for line in path.read_text().splitlines():
            key,sep,value=line.strip().partition('=')
            if sep and key in ('FEA_API_TOKEN','CCX_BIN','FEA_JOB_DIR'):
                os.environ.setdefault(key,value.strip().strip('"').strip("'"))
if len(os.environ.get('FEA_API_TOKEN',''))<24:
    sys.exit('Defina FEA_API_TOKEN (24+ caracteres) em .env.local. Consulte docs/SIMULATION.md.')
folder=Path(__file__).resolve().parent
python=folder/'.venv/bin/python'
if not python.exists():
    sys.exit('Crie services/fea/.venv e instale requirements.txt. Consulte docs/SIMULATION.md.')
local=folder/'.runtime/usr'
if (local/'bin/ccx').exists():
    os.environ.setdefault('CCX_BIN',str(local/'bin/ccx'))
    os.environ['LD_LIBRARY_PATH']=str(local/'lib/x86_64-linux-gnu')+(':'+os.environ['LD_LIBRARY_PATH'] if os.environ.get('LD_LIBRARY_PATH') else '')
os.environ.setdefault('OPENBLAS_NUM_THREADS','1')
os.chdir(folder)
os.execv(str(python),[str(python),'-m','uvicorn','app:app','--host','127.0.0.1','--port','8090','--workers','1'])

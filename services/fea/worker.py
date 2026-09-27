"""One disposable native-process group per job, invoked only by the service."""
import json
import sys
from pathlib import Path
from engine import generate_mesh, solve

folder=Path(sys.argv[1])
try:
    # Limit native allocations on Linux, in addition to container limits.
    import resource
    resource.setrlimit(resource.RLIMIT_AS,(3*1024**3,3*1024**3))
    resource.setrlimit(resource.RLIMIT_FSIZE,(256*1024**2,256*1024**2))
except (ImportError,ValueError):
    pass
try:
    payload=json.loads((folder/'request.json').read_text())
    if payload['action']=='mesh':
        result={'mesh':generate_mesh(payload,folder)}
    else:
        mesh=json.loads((Path(payload['meshFolder'])/'result.json').read_text())['mesh']
        result={'results':solve(mesh,payload['study'],folder)}
    (folder/'result.json').write_text(json.dumps(result,allow_nan=False))
except Exception as error:
    (folder/'error.txt').write_text(str(error) if isinstance(error,ValueError) else 'Falha no processamento. Confira os logs do serviço FEA.')
    raise

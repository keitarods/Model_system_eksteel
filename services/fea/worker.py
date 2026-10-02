"""One disposable native-process group per job, invoked only by the service."""
import json
import sys
from pathlib import Path
from engine import generate_mesh, solve

def main(folder):
    folder=Path(folder)
    try:
        # Limit native allocations on Linux, in addition to container limits.
        import resource
        resource.setrlimit(resource.RLIMIT_AS,(3*1024**3,3*1024**3))
        resource.setrlimit(resource.RLIMIT_FSIZE,(256*1024**2,256*1024**2))
    except (ImportError,ValueError):
        pass
    def progress(percent, stage):
        temporary=folder/'progress.tmp'
        temporary.write_text(json.dumps({'percent':percent,'stage':stage}))
        temporary.replace(folder/'progress.json')
    try:
        payload=json.loads((folder/'request.json').read_text())
        if payload['action']=='mesh':
            result={'mesh':generate_mesh(payload,folder,progress)}
        else:
            mesh=json.loads((Path(payload['meshFolder'])/'result.json').read_text())['mesh']
            result={'results':solve(mesh,payload['study'],folder,progress)}
        progress(95, 'Salvando resultados')
        (folder/'result.json').write_text(json.dumps(result,allow_nan=False))
    except Exception as error:
        (folder/'error.txt').write_text(str(error) if isinstance(error,ValueError) else 'Falha no processamento. Confira os logs do serviço FEA.')
        raise


if __name__=='__main__':
    main(sys.argv[1])

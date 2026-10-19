"""Reproduce STEP meshing with the production worker, without uploading CAD.

Example: .venv/bin/python diagnose_step.py model.stp --size 40 --body 1 --output report.json
Omit --body to test the full assembly. Reports never embed STEP contents.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('step', type=Path)
    parser.add_argument('--size', type=float, default=10)
    parser.add_argument('--minimum', type=float)
    parser.add_argument('--curvature', type=float, default=0)
    parser.add_argument('--adaptive-curvature', action='store_true')
    parser.add_argument('--body', type=int, action='append', help='Prepared body index; repeat to test several bodies')
    parser.add_argument('--unite', action='store_true')
    parser.add_argument('--heal', action='store_true')
    parser.add_argument('--timeout', type=float, default=240)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if not 0 < args.timeout <= 3600:
        parser.error('--timeout must be between 0 and 3600 seconds')
    data = args.step.read_bytes()
    payload = {'step': data.decode('utf-8'), 'size': args.size,
               'geometryMode': 'assemblyBonded', 'elementType': 'C3D4',
               'preparation': {'unite': args.unite, 'heal': args.heal},
               'meshControls': {'minimumSize': args.minimum if args.minimum is not None else args.size,
                                'curvature': args.curvature, 'adaptiveCurvature': args.adaptive_curvature}}
    import gmsh
    report = {'file': args.step.name, 'sha256': hashlib.sha256(data).hexdigest(),
              'gmsh': gmsh.__version__, 'settings': {k: v for k, v in payload.items() if k != 'step'},
              'runs': []}
    for body in args.body or [None]:
        request = {**payload, 'action': 'mesh' if body is None else 'diagnose'}
        if body is not None:
            request['bodyIndex'] = body
        started = time.monotonic()
        with tempfile.TemporaryDirectory(prefix='eksteel-diagnostic-') as directory:
            folder = Path(directory)
            (folder / 'request.json').write_text(json.dumps(request))
            result = {'body': body}
            with (folder / 'worker.log').open('w') as log:
                try:
                    process = subprocess.run([sys.executable, str(Path(__file__).with_name('worker.py')), directory],
                                             stdout=log, stderr=subprocess.STDOUT, timeout=args.timeout)
                    if process.returncode:
                        result.update(status='error', returncode=process.returncode,
                                      message=(folder / 'error.txt').read_text() if (folder / 'error.txt').exists() else 'Native process failed')
                    else:
                        output = json.loads((folder / 'result.json').read_text())
                        if body is not None:
                            result.update(output['diagnostic'])
                        else:
                            mesh = output['mesh']
                            result.update(status='passed', nodes=len(mesh['nodes']), elements=len(mesh['tetrahedra']),
                                          quality=mesh['quality'], preparationReport=mesh['preparationReport'])
                except subprocess.TimeoutExpired:
                    result.update(status='timeout', message='Native worker exceeded the time limit')
            if result['status'] in ('error', 'timeout'):
                result['logTail'] = (folder / 'worker.log').read_text(errors='replace')[-6000:]
        result['seconds'] = round(time.monotonic() - started, 3)
        report['runs'].append(result)
        args.output.write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
        print(json.dumps(result, ensure_ascii=False), flush=True)
    return 0 if all(run['status'] == 'passed' for run in report['runs']) else 1


if __name__ == '__main__':
    sys.exit(main())

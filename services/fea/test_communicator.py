"""Real loopback protocol + native worker test; also runs against a frozen binary."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from urllib.error import HTTPError
from urllib.request import Request,urlopen
from test_engine import box_step


class CommunicatorTests(unittest.TestCase):
    def test_pair_mesh_solve_download_and_revoke(self):
        with tempfile.TemporaryDirectory() as directory:
            folder=Path(directory);pairing=folder/'pairing.json';origin='https://app.example.com'
            executable=os.environ.get('FEA_COMMUNICATOR_EXE')
            command=[executable] if executable else [sys.executable,str(Path(__file__).with_name('communicator.py'))]
            command+=['--headless','--origin',origin,'--pairing-file',str(pairing)]
            with (folder/'process.log').open('w') as log:
                process=subprocess.Popen(command,stdout=log,stderr=subprocess.STDOUT)
                try:
                    for _ in range(100):
                        if process.poll() is not None:self.fail((folder/'process.log').read_text())
                        if pairing.exists():break
                        time.sleep(.1)
                    else:self.fail('Communicator did not start')
                    code=json.loads(pairing.read_text())['code']
                    headers={'Origin':origin,'Content-Type':'application/json'}
                    def call(path,method='GET',payload=None,extra=None,text=False):
                        request=Request('http://127.0.0.1:8091'+path,method=method,data=json.dumps(payload).encode() if payload else None,headers={**headers,**(extra or {})})
                        with urlopen(request,timeout=15) as response:
                            self.assertEqual(response.headers['Access-Control-Allow-Origin'],origin)
                            return response.read().decode() if text else json.load(response)
                    # Wait until the HTTP server starts accepting requests.
                    for _ in range(100):
                        try:call('/pair','OPTIONS',extra={'Access-Control-Request-Method':'POST'});break
                        except json.JSONDecodeError:break  # OPTIONS 204 has no body
                        except OSError:time.sleep(.1)
                    paired=call('/pair','POST',extra={'X-Eksteel-Pairing':code})
                    headers['Authorization']='Bearer '+paired['token']
                    self.assertTrue(call('/health')['ready'])
                    with self.assertRaises(HTTPError) as denied:call('/health',extra={'Origin':'https://evil.example'})
                    self.assertEqual(denied.exception.code,403)
                    with self.assertRaises(HTTPError):call('/pair','POST',extra={'X-Eksteel-Pairing':code})
                    def complete(payload):
                        job=call('/jobs','POST',payload)
                        for _ in range(200):
                            state=call('/jobs/'+job['id'])
                            if state.get('progress'):
                                self.assertGreaterEqual(state['progress']['percent'],0)
                                self.assertLessEqual(state['progress']['percent'],100)
                            if state['status']=='completed':
                                self.assertEqual(state['progress']['percent'],100)
                                return job['id'],call('/jobs/'+job['id']+'/result')
                            self.assertIn(state['status'],('queued','running'),state)
                            time.sleep(.1)
                        self.fail('Job timeout')
                    mesh_id,output=complete({'action':'mesh','step':box_step(folder),'size':5,'elementType':'C3D10','preparation':{'heal':True,'tolerance':.001}})
                    mesh=output['mesh'];faces=mesh['faces']
                    study={'material':{'young':210000,'poisson':0,'density':7850,'yieldStress':250},'supports':[{'faceIds':[min(faces,key=lambda f:f['center'][0])['id']],'axes':[True]*3}],'loads':[{'kind':'force','faceIds':[max(faces,key=lambda f:f['center'][0])['id']],'vector':[1000,0,0]}]}
                    solve_id,result=complete({'action':'solve','meshId':mesh_id,'study':study})
                    self.assertAlmostEqual(result['results']['summary']['maxVonMises'],10,places=2)
                    self.assertIn('*ELEMENT, TYPE=C3D10',call('/jobs/'+solve_id+'/input',text=True))
                    self.assertTrue(call('/disconnect','DELETE')['disconnected'])
                    with self.assertRaises(HTTPError) as denied:call('/jobs/'+solve_id+'/result')
                    self.assertEqual(denied.exception.code,401)
                finally:
                    if process.poll() is None:
                        if os.name=='nt':process.terminate()
                        else:process.send_signal(signal.SIGINT)
                        try:process.wait(timeout=20)
                        except subprocess.TimeoutExpired:process.kill();process.wait()

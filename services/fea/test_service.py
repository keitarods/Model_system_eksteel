import json
import os
import tempfile
import time
import unittest
from pathlib import Path
os.environ['FEA_API_TOKEN']='test-token-only-for-local-tests-00000000'
_TEMP=tempfile.TemporaryDirectory()
os.environ['FEA_JOB_DIR']=_TEMP.name
from fastapi.testclient import TestClient
from app import app
from test_engine import box_step, assembly_step

HEADERS={'Authorization':'Bearer '+os.environ['FEA_API_TOKEN'],'X-FEA-Owner':'a'*64}
class ServiceTests(unittest.TestCase):
    def test_auth_job_ownership_mesh_and_solve(self):
        with TestClient(app) as client:
            self.assertEqual(client.get('/health').status_code,401)
            self.assertTrue(client.get('/health',headers=HEADERS).json()['ready'])
            with tempfile.TemporaryDirectory() as temp:step=box_step(Path(temp))
            job=client.post('/jobs',headers=HEADERS,json={'action':'mesh','step':step,'size':5,'refinements':[]})
            self.assertEqual(job.status_code,202,job.text)
            job_id=job.json()['id']
            other={**HEADERS,'X-FEA-Owner':'b'*64}
            self.assertEqual(client.get('/jobs/'+job_id,headers=other).status_code,404)
            self.assertEqual(client.delete('/jobs/'+job_id,headers=other).status_code,404)
            def wait(job_id):
                deadline=time.time()+30
                while time.time()<deadline:
                    info=client.get('/jobs/'+job_id,headers=HEADERS).json()
                    if info['status'] not in ('queued','running'):
                        self.assertEqual(info['status'],'completed',info)
                        return client.get('/jobs/'+job_id+'/result',headers=HEADERS).json()
                    time.sleep(.1)
                self.fail('Job timeout')
            mesh=wait(job_id)['mesh']
            left=min(mesh['faces'],key=lambda f:f['center'][0])['id'];right=max(mesh['faces'],key=lambda f:f['center'][0])['id']
            study={'material':{'young':210000,'poisson':0,'density':7850,'yieldStress':250},'supports':[{'faceIds':[left],'axes':[True,True,True]}],'loads':[{'kind':'force','faceIds':[right],'vector':[1000,0,0]}]}
            denied=client.post('/jobs',headers=other,json={'action':'solve','meshId':job_id,'study':study})
            self.assertEqual(denied.status_code,404)
            solve_job=client.post('/jobs',headers=HEADERS,json={'action':'solve','meshId':job_id,'study':study})
            self.assertEqual(solve_job.status_code,202,solve_job.text)
            solve_id=solve_job.json()['id'];result=wait(solve_id)['results']
            self.assertAlmostEqual(result['summary']['maxVonMises'],10,places=3)
            self.assertIn('*ELEMENT, TYPE=C3D4',client.get('/jobs/'+solve_id+'/input',headers=HEADERS).text)
            self.assertEqual(client.get('/jobs/'+solve_id+'/input',headers=other).status_code,404)
            with tempfile.TemporaryDirectory() as temp:assembly=assembly_step(Path(temp))
            assembly_job=client.post('/jobs',headers=HEADERS,json={'action':'mesh','step':assembly,'size':5,'refinements':[],'geometryMode':'assemblyBonded'})
            self.assertEqual(assembly_job.status_code,202,assembly_job.text)
            assembly_mesh=wait(assembly_job.json()['id'])['mesh']
            self.assertEqual(assembly_mesh['geometryMode'],'assemblyBonded')
            self.assertEqual(assembly_mesh['bodyCount'],1)
            pending=client.post('/jobs',headers=HEADERS,json={'action':'mesh','step':step,'size':1,'refinements':[]}).json()['id']
            self.assertEqual(client.delete('/jobs/'+pending,headers=HEADERS).json()['status'],'cancelled')
            time.sleep(.1)
            self.assertEqual(client.get('/jobs/'+pending,headers=HEADERS).json()['status'],'cancelled')
    def test_cancellation_and_invalid_payload(self):
        # No TestClient lifespan here: first test manages the shared executor.
        client=TestClient(app)
        self.assertEqual(client.post('/jobs',headers=HEADERS,json={'action':'invalid'}).status_code,400)
        self.assertEqual(client.post('/jobs',headers=HEADERS,json={'action':'mesh','step':'not STEP'}).status_code,400)
        # Cancellation uses the same owner check as reads and results.
        self.assertEqual(client.delete('/jobs/not-a-job',headers=HEADERS).status_code,404)

if __name__=='__main__':unittest.main(verbosity=2)

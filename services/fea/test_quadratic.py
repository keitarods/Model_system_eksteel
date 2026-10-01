import tempfile
import unittest
from pathlib import Path
import numpy as np
from engine import generate_mesh, solve, prepare_analysis
from elements import integration, positive_order
from test_engine import box_step


class QuadraticTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(); cls.folder = Path(cls.temp.name)
        cls.step = box_step(cls.folder)
        cls.mesh = generate_mesh({'step':cls.step,'size':5,'elementType':'C3D10'},cls.folder)
    @classmethod
    def tearDownClass(cls): cls.temp.cleanup()
    def study(self):
        return {'material':{'young':210000,'poisson':0,'density':7850,'yieldStress':250},
            'supports':[{'faceIds':[min(self.mesh['faces'],key=lambda f:f['center'][0])['id']],'axes':[True]*3}],
            'loads':[{'kind':'force','faceIds':[max(self.mesh['faces'],key=lambda f:f['center'][0])['id']],'vector':[1000,0,0]}]}
    def test_axial_patch_and_energy(self):
        result = solve(self.mesh,self.study(),self.folder)
        self.assertEqual(result['elementType'],'C3D10')
        self.assertAlmostEqual(result['summary']['maxDisplacement'],1000*100/(100*210000),places=8)
        self.assertAlmostEqual(result['summary']['maxVonMises'],10,places=3)
        self.assertAlmostEqual(result['summary']['strainEnergy'],.5*1000*1000*100/(100*210000),places=5)
        np.testing.assert_allclose(result['summary']['reaction'],[-1000,0,0],atol=.02)
    def test_bending_accuracy(self):
        study=self.study();study['material']['poisson']=.3;study['loads'][0]['vector']=[0,0,-10]
        result=solve(self.mesh,study,self.folder)
        reference=10*100**3/(3*210000*(10*10**3/12))
        print('C3D10 bending:',result['summary']['maxDisplacement'],'reference:',reference)
        self.assertLess(abs(result['summary']['maxDisplacement']/reference-1),.05)
    def test_pressure_and_gravity_consistency(self):
        study=self.study();study['loads'][0]={'kind':'pressure','faceIds':study['loads'][0]['faceIds'],'pressure':2}
        nodes,_,forces,_=prepare_analysis(self.mesh,study)
        np.testing.assert_allclose(forces.sum(axis=0),[-200,0,0],atol=1e-8)
        loaded=next(f for f in self.mesh['faces'] if f['id']==study['loads'][0]['faceIds'][0])
        corners=sorted({n for tri in loaded['loadTriangles'] for n in tri[:3]})
        np.testing.assert_allclose(forces[corners],0,atol=1e-12)
        np.testing.assert_allclose(np.cross(nodes-[100,5,5],forces).sum(axis=0),0,atol=1e-8)
        for face in self.mesh['faces']:
            for tri in face['loadTriangles']:
                self.assertEqual(len(tri),6)
        study['loads']=[{'kind':'gravity','vector':[0,0,-9.80665]}]
        _,_,forces,_=prepare_analysis(self.mesh,study)
        np.testing.assert_allclose(forces.sum(axis=0),[0,0,-7850*1e-9*10000*9.80665],atol=1e-8)
        np.testing.assert_allclose(np.cross(nodes-[50,5,5],forces).sum(axis=0),0,atol=1e-8)
        solve(self.mesh,study,self.folder)
    def test_partition_and_rigid_rotation(self):
        points=np.array(self.mesh['nodes']);tet=self.mesh['tetrahedra'][0]
        for b,_,shape in integration(points[tet]):
            self.assertAlmostEqual(shape.sum(),1)
            np.testing.assert_allclose(b@np.cross([.2,.3,.4],points[tet]).reshape(-1),0,atol=1e-12)
        reversed_tet=[tet[i] for i in [0,2,1,3,6,5,4,7,9,8]]
        corrected=positive_order(reversed_tet,points)
        for b,_,_ in integration(points[corrected]):
            np.testing.assert_allclose(b@points[corrected].reshape(-1),[1,1,1,0,0,0],atol=1e-12)

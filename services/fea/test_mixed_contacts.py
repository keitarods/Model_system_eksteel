"""Three bars in series: permanent bond followed by opening contact."""
import tempfile
import unittest
from pathlib import Path
import gmsh
import numpy as np
from engine import generate_mesh, solve, prepare_analysis


class MixedContactTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory();cls.folder=Path(cls.temp.name)
        gmsh.initialize(['test','-nopopup']);gmsh.option.setNumber('General.Terminal',0)
        try:
            for x in (0,50,100):gmsh.model.occ.addBox(x,0,0,50,10,10)
            gmsh.model.occ.synchronize();path=cls.folder/'three.step';gmsh.write(str(path));step=path.read_text()
        finally:gmsh.finalize()
        cls.meshes=[generate_mesh({'step':step,'size':5,'geometryMode':'assemblyBonded','elementType':kind,'preparation':{'unite':False}},cls.folder) for kind in ('C3D4','C3D10')]
    @classmethod
    def tearDownClass(cls):cls.temp.cleanup()
    def study(self,mesh,force=-1000):
        faces=mesh['faces']
        left=sorted([f for f in faces if abs(f['center'][0]-50)<1e-6],key=lambda f:f['bodyId'])
        right=sorted([f for f in faces if abs(f['center'][0]-100)<1e-6],key=lambda f:f['bodyId'])
        return {'material':{'young':210000,'poisson':0,'density':7850,'yieldStress':250},
            'supports':[{'faceIds':[min(faces,key=lambda f:f['center'][0])['id'],max(faces,key=lambda f:f['center'][0])['id']],'axes':[True]*3}],
            'loads':[{'kind':'force','faceIds':[right[1]['id']],'vector':[force,0,0]}],
            'contacts':[{'id':'permanent','kind':'bonded','masterFaceId':left[0]['id'],'slaveFaceId':left[1]['id']},
            {'id':'opening','kind':'frictionless','masterFaceId':right[0]['id'],'slaveFaceId':right[1]['id'],'normalStiffness':1e6,'searchDistance':.1}]}
    def test_force_transfer_and_opening_in_both_orders(self):
        for mesh in self.meshes:
            for force in (-1000,1000):
                with self.subTest(element=mesh['elementType'],force=force):
                    s=self.study(mesh,force);r=solve(mesh,s,self.folder);bond,contact=r['contacts']
                    self.assertEqual([c['id'] for c in r['contacts']],['permanent','opening'])
                    self.assertEqual(r['nonlinearHistory'][-1]['loadFactor'],1)
                    # Left branch stiffness EA/100; right branch EA/50.
                    expected=1000/3 if force<0 else 0
                    self.assertAlmostEqual(contact['slaveForce'][0],expected,delta=3)
                    self.assertAlmostEqual(bond['slaveForce'][0],expected,delta=3)
                    self.assertLess(bond['maxRelativeDisplacement'],1e-8)
                    np.testing.assert_allclose(r['summary']['reaction'],[-force,0,0],atol=.1)
                    np.testing.assert_allclose(np.sum(r['nodalContactForces'],axis=0),0,atol=1e-8)
                    if force>0:self.assertEqual(contact['activePoints'],0)
                    deck=(self.folder/'analysis.inp').read_text()
                    self.assertIn('*EQUATION',deck)
                    if force<0:self.assertIn('TYPE=SPRINGA',deck)
    def test_contact_order_does_not_change_physics(self):
        mesh=self.meshes[0];s=self.study(mesh);a=solve(mesh,s,self.folder)
        s['contacts'].reverse();b=solve(mesh,s,self.folder)
        self.assertEqual([c['id'] for c in b['contacts']],['opening','permanent'])
        np.testing.assert_allclose(a['displacements'],b['displacements'],atol=1e-10)
    def test_open_contact_cannot_replace_support_or_permanent_bond(self):
        mesh=self.meshes[0];s=self.study(mesh)
        s['supports'][0]['faceIds'].pop()
        with self.assertRaisesRegex(ValueError,'corpo rígido'):prepare_analysis(mesh,s)
        s=self.study(mesh);s['contacts'].pop(0)
        with self.assertRaisesRegex(ValueError,'corpo rígido'):prepare_analysis(mesh,s)

"""Analytical two-bar contact and active-set regression cases."""
import copy
import tempfile
import unittest
from pathlib import Path
import numpy as np
from engine import generate_mesh, solve, prepare_analysis, connected_bodies, parse_displacements
from test_engine import assembly_step
from unilateral import solve_incremental


class UnilateralTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory();cls.folder=Path(cls.temp.name)
        step=assembly_step(cls.folder)
        cls.meshes=[generate_mesh({'step':step,'size':5,'geometryMode':'assemblyBonded','elementType':kind,'preparation':{'unite':False}},cls.folder) for kind in ('C3D4','C3D10')]
    @classmethod
    def tearDownClass(cls):cls.temp.cleanup()
    def study(self,mesh,force=-1000):
        master,slave=sorted([f for f in mesh['faces'] if abs(f['center'][0]-50)<.01],key=lambda f:f['bodyId'])
        return {'material':{'young':210000,'poisson':0,'density':7850,'yieldStress':250},
            'contacts':[{'id':'contact','kind':'frictionless','masterFaceId':master['id'],'slaveFaceId':slave['id'],'normalStiffness':1e6,'searchDistance':.1}],
            'supports':[{'faceIds':[min(mesh['faces'],key=lambda f:f['center'][0])['id'],max(mesh['faces'],key=lambda f:f['center'][0])['id']],'axes':[True]*3}],
            'loads':[{'kind':'force','faceIds':[slave['id']],'vector':[force,0,0]}]}
    def test_compression_and_separation_both_orders(self):
        for mesh in self.meshes:
            for force in (-1000,1000):
                with self.subTest(element=mesh['elementType'],force=force):
                    r=solve(mesh,self.study(mesh,force),self.folder);c=r['contacts'][0]
                    self.assertEqual(r['nonlinearHistory'][-1]['loadFactor'],1)
                    np.testing.assert_allclose(r['summary']['reaction'],[-force,0,0],atol=.1)
                    np.testing.assert_allclose(np.sum(r['nodalContactForces'],axis=0),0,atol=1e-8)
                    if force<0:
                        self.assertAlmostEqual(c['slaveForce'][0],500,delta=3)
                        self.assertGreater(c['maxPenetration'],0)
                        self.assertEqual(c['maxOpening'],0)
                    else:
                        self.assertEqual(c['activePoints'],0)
                        self.assertEqual(c['maxPressure'],0)
                        self.assertEqual(c['slaveForce'],[0,0,0])
                        self.assertAlmostEqual(c['maxOpening'],1000/420000,delta=1e-7)
    def test_initial_gap_closes_during_loading(self):
        mesh=copy.deepcopy(self.meshes[1]);s=self.study(mesh)
        slave=next(f for f in mesh['faces'] if f['id']==s['contacts'][0]['slaveFaceId'])
        for n in connected_bodies(mesh['tetrahedra'])[slave['bodyId']-1]:mesh['nodes'][n][0]+=.001
        r=solve(mesh,s,self.folder)
        self.assertEqual(r['nonlinearHistory'][0]['activePoints'],0)
        self.assertGreater(r['nonlinearHistory'][-1]['activePoints'],0)
        self.assertAlmostEqual(r['contacts'][0]['slaveForce'][0],290,delta=3)
    def test_open_contact_requires_independent_restraints(self):
        s=self.study(self.meshes[0]);s['supports'][0]['faceIds']=s['supports'][0]['faceIds'][:1]
        with self.assertRaisesRegex(ValueError,'corpo rígido'):prepare_analysis(self.meshes[0],s)
    def test_invalid_contact_parameters(self):
        for key,value in [('normalStiffness',0),('normalStiffness',float('nan')),('searchDistance',-1),('searchDistance',11)]:
            s=self.study(self.meshes[0]);s['contacts'][0][key]=value
            with self.assertRaises(ValueError):prepare_analysis(self.meshes[0],s)
    def test_unconverged_active_set_never_returns_partial_results(self):
        interface={'normal':np.array([1.,0,0]),'gaps':[0.], 'mappings':[(0,np.array([1]),np.array([1.]))]}
        def cycle(load,active,timeout):return np.array([[1. if active[0][0] else -1.,0,0],[0,0,0]])
        with self.assertRaisesRegex(ValueError,'não convergiu'):solve_incremental({'nodes':[[0,0,0],[1,0,0]]},[interface],cycle)

    def test_displacement_parser_uses_complete_last_block_only(self):
        header=' displacements (vx,vy,vz) for set NALL and time 1.0\n\n'
        first=header+' 1 1.0 2.0 3.0\n 2 4.0 5.0 6.0\n'
        forces=' forces (fx,fy,fz) for set NALL\n 1 99 99 99\n 2 99 99 99\n'
        np.testing.assert_allclose(parse_displacements(first+forces,2),[[1,2,3],[4,5,6]])
        np.testing.assert_allclose(parse_displacements(first+header+' 1 0 0 0\n 2 1D-3 0 0\n',2),[[0,0,0],[.001,0,0]])
        with self.assertRaisesRegex(ValueError,'completos'):parse_displacements(first+header+' 1 0 0 0\n',2)
        with self.assertRaisesRegex(ValueError,'repetido'):parse_displacements(header+' 1 0 0 0\n 1 0 0 0\n',2)
    def test_oblique_interface_transmits_only_normal_force(self):
        mesh=copy.deepcopy(self.meshes[0]);s=self.study(mesh)
        a=.61;b=.37
        rotation=np.array([[np.cos(a),-np.sin(a),0],[np.sin(a),np.cos(a),0],[0,0,1.]])@np.array([[np.cos(b),0,np.sin(b)],[0,1,0],[-np.sin(b),0,np.cos(b)]])
        mesh['nodes']=(np.array(mesh['nodes'])@rotation.T).tolist()
        for face in mesh['faces']:
            face['center']=(rotation@face['center']).tolist()
            if 'normal' in face:face['normal']=(rotation@face['normal']).tolist()
        s['loads'][0]['vector']=(rotation@np.array([-1000.,0,0])).tolist()
        r=solve(mesh,s,self.folder);force=np.array(r['contacts'][0]['slaveForce']);normal=rotation[:,0]
        self.assertAlmostEqual(force@normal,500,delta=3)
        np.testing.assert_allclose(force-normal*(force@normal),0,atol=1e-8)
        np.testing.assert_allclose(r['summary']['reaction'],1000*normal,atol=.1)

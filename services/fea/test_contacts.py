import copy
import tempfile
import unittest
from pathlib import Path
import numpy as np
from engine import generate_mesh, solve, prepare_analysis, connected_bodies
from contacts import build_bonds, covered_surface
from test_engine import assembly_step


class BondedContactTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory();cls.folder=Path(cls.temp.name)
        cls.step=assembly_step(cls.folder)
        cls.linear=generate_mesh({'step':cls.step,'size':5,'geometryMode':'assemblyBonded','preparation':{'unite':False}},cls.folder)
        interfaces=[f for f in cls.linear['faces'] if abs(f['center'][0]-50)<1e-6]
        cls.master,cls.slave=sorted(interfaces,key=lambda f:f['bodyId'])
        cls.quadratic=generate_mesh({'step':cls.step,'size':5,'geometryMode':'assemblyBonded','elementType':'C3D10','preparation':{'unite':False}},cls.folder)
    @classmethod
    def tearDownClass(cls):cls.temp.cleanup()
    def study(self,mesh):
        return {'material':{'young':210000,'poisson':0,'density':7850,'yieldStress':250},
            'contacts':[{'id':'bond','kind':'bonded','masterFaceId':self.master['id'],'slaveFaceId':self.slave['id']}],
            'supports':[{'faceIds':[min(mesh['faces'],key=lambda f:f['center'][0])['id']],'axes':[True]*3}],
            'loads':[{'kind':'force','faceIds':[max(mesh['faces'],key=lambda f:f['center'][0])['id']],'vector':[1000,0,0]}]}
    def test_axial_transfer_linear_and_nonmatching_quadratic(self):
        for mesh in (self.linear,self.quadratic):
            with self.subTest(element=mesh['elementType']):
                self.assertEqual(mesh['bodyCount'],2)
                result=solve(mesh,self.study(mesh),self.folder)
                # Nodal interpolation ties can perturb local stress on nonmatching grids.
                # Validate global compliance/energy to 0.1%, and force conservation.
                expected=1000*100/(210000*100)
                self.assertLess(abs(result['summary']['maxDisplacement']/expected-1),.001)
                self.assertLess(abs(result['summary']['strainEnergy']/(.5*1000*expected)-1),.001)
                np.testing.assert_allclose(result['summary']['reaction'],[-1000,0,0],atol=.02)
                np.testing.assert_allclose(result['contacts'][0]['slaveForce'],[-1000,0,0],atol=.02)
                np.testing.assert_allclose(np.sum(result['nodalContactForces'],axis=0),0,atol=1e-8)
                self.assertLess(result['contacts'][0]['maxRelativeDisplacement'],1e-8)
                self.assertIn('*EQUATION',(self.folder/'analysis.inp').read_text())
        bonds=build_bonds(self.quadratic,self.study(self.quadratic),connected_bodies(self.quadratic['tetrahedra']),set())
        self.assertTrue(any(np.sum(np.abs(w)>1e-8)>1 for _,_,w in bonds[0]['mappings']))
    def test_bending_transfers_moment(self):
        study=self.study(self.quadratic);study['material']['poisson']=.3;study['loads'][0]['vector']=[0,0,-10]
        result=solve(self.quadratic,study,self.folder)
        analytic=10*100**3/(3*210000*(10*10**3/12))
        self.assertLess(abs(result['summary']['maxDisplacement']/analytic-1),.05)
        self.assertLess(result['summary']['momentBalanceError'],.1)
    def test_unbonded_and_unrestrained_are_rejected(self):
        study=self.study(self.linear);study['contacts']=[]
        with self.assertRaisesRegex(ValueError,'corpo rígido'):prepare_analysis(self.linear,study)
        study=self.study(self.linear);study['supports']=[]
        with self.assertRaisesRegex(ValueError,'corpo rígido'):prepare_analysis(self.linear,study)
    def test_fixed_slave_duplicate_and_gap_rejected(self):
        study=self.study(self.linear);study['supports'][0]['faceIds']=[self.slave['id']]
        with self.assertRaisesRegex(ValueError,'fixação'):prepare_analysis(self.linear,study)
        study=self.study(self.linear);study['contacts'].append({**study['contacts'][0],'id':'duplicate'})
        with self.assertRaisesRegex(ValueError,'duas faces dependentes'):prepare_analysis(self.linear,study)
        shifted=copy.deepcopy(self.linear)
        body=connected_bodies(shifted['tetrahedra'])[self.slave['bodyId']-1]
        for n in body:shifted['nodes'][n][0]+=.01
        with self.assertRaisesRegex(ValueError,'integralmente'):prepare_analysis(shifted,self.study(shifted))
    def test_invalid_contact_kind_and_same_body(self):
        study=self.study(self.linear);study['contacts'][0]['kind']='unknown'
        with self.assertRaisesRegex(ValueError,'inválido'):prepare_analysis(self.linear,study)
        study=self.study(self.linear);study['contacts'][0]['slaveFaceId']=study['supports'][0]['faceIds'][0]
        with self.assertRaisesRegex(ValueError,'independentes'):prepare_analysis(self.linear,study)

    def test_matching_quadratic_patch_has_uniform_stress(self):
        mesh=generate_mesh({'step':self.step,'size':5,'geometryMode':'assemblyBonded','elementType':'C3D10','preparation':{'unite':False},'refinements':[{'faceId':self.slave['id'],'size':3}]},self.folder)
        result=solve(mesh,self.study(mesh),self.folder)
        self.assertAlmostEqual(result['summary']['maxDisplacement'],1000*100/(210000*100),places=8)
        self.assertAlmostEqual(result['summary']['maxVonMises'],10,places=3)

    def test_cycles_and_nonplanar_faces_rejected(self):
        study=self.study(self.linear)
        study['contacts'].append({'id':'reverse','kind':'bonded','masterFaceId':self.slave['id'],'slaveFaceId':self.master['id']})
        with self.assertRaisesRegex(ValueError,'também é mestre'):prepare_analysis(self.linear,study)
        distorted=copy.deepcopy(self.linear)
        node=self.slave['triangles'][0][0];distorted['nodes'][node][0]+=.01
        with self.assertRaisesRegex(ValueError,'planas'):prepare_analysis(distorted,self.study(distorted))

    def test_surface_coverage_rejects_missing_area(self):
        full=np.array([[[0,0,0],[1,0,0],[1,1,0]],[[0,0,0],[1,1,0],[0,1,0]]],dtype=float)
        covered_surface(full,full,np.array([0.,0.,1.]))
        with self.assertRaisesRegex(ValueError,'cobertura parcial'):
            covered_surface(full[:1],full,np.array([0.,0.,1.]))

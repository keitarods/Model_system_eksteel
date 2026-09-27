import os
import tempfile
import unittest
from pathlib import Path
import gmsh
import numpy as np
from engine import generate_mesh, prepare_analysis, solve, connected_bodies


def box_step(folder):
    gmsh.initialize(['test','-nopopup']);gmsh.option.setNumber('General.Terminal',0)
    try:
        gmsh.model.occ.addBox(0,0,0,100,10,10);gmsh.model.occ.synchronize()
        path=folder/'box.step';gmsh.write(str(path));return path.read_text()
    finally:gmsh.finalize()


def assembly_step(folder, separated=False):
    gmsh.initialize(['test','-nopopup']);gmsh.option.setNumber('General.Terminal',0)
    try:
        gmsh.model.occ.addBox(0,0,0,50,10,10)
        gmsh.model.occ.addBox(60 if separated else 50,0,0,50,10,10)
        gmsh.model.occ.synchronize()
        path=folder/'assembly.step';gmsh.write(str(path));return path.read_text()
    finally:gmsh.finalize()


class EngineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary=tempfile.TemporaryDirectory();cls.folder=Path(cls.temporary.name)
        cls.step=box_step(cls.folder)
        cls.mesh=generate_mesh({'step':cls.step,'size':5,'refinements':[]},cls.folder)
        cls.left=min(cls.mesh['faces'],key=lambda f:f['center'][0])['id']
        cls.right=max(cls.mesh['faces'],key=lambda f:f['center'][0])['id']
    @classmethod
    def tearDownClass(cls):cls.temporary.cleanup()
    def study(self):
        return {'material':{'young':210000,'poisson':0,'density':7850,'yieldStress':250},'supports':[{'faceIds':[self.left],'axes':[True,True,True]}],'loads':[{'kind':'force','faceIds':[self.right],'vector':[1000,0,0]}]}
    def test_axial_analytic_and_reactions(self):
        result=solve(self.mesh,self.study(),self.folder)
        expected=1000*100/(100*210000)
        self.assertAlmostEqual(result['summary']['maxDisplacement']/expected,1,places=4)
        self.assertAlmostEqual(result['summary']['maxVonMises'],10,places=3)
        np.testing.assert_allclose(result['summary']['reaction'],[-1000,0,0],atol=0.02)
        self.assertLess(result['summary']['balanceError'],0.02)
    def test_load_conservation_pressure_and_gravity(self):
        study=self.study();_,_,forces,_=prepare_analysis(self.mesh,study)
        np.testing.assert_allclose(forces.sum(axis=0),[1000,0,0],atol=1e-8)
        study['loads']=[{'kind':'pressure','faceIds':[self.right],'pressure':2}]
        _,_,forces,_=prepare_analysis(self.mesh,study)
        np.testing.assert_allclose(forces.sum(axis=0),[-200,0,0],atol=1e-8)
        study['loads']=[{'kind':'gravity','vector':[0,0,-9.80665]}]
        _,_,forces,_=prepare_analysis(self.mesh,study)
        np.testing.assert_allclose(forces.sum(axis=0),[0,0,-7850*1e-9*10000*9.80665],atol=1e-8)
    def test_rigid_modes_and_invalid_inputs(self):
        study=self.study();study['supports'][0]['axes']=[True,False,False]
        with self.assertRaisesRegex(ValueError,'corpo rígido'):prepare_analysis(self.mesh,study)
        study=self.study();study['loads'][0]['faceIds']=[9999]
        with self.assertRaisesRegex(ValueError,'faces válidas'):prepare_analysis(self.mesh,study)
        study=self.study();study['material']['poisson']=0.5
        with self.assertRaises(ValueError):prepare_analysis(self.mesh,study)
    def test_refinement_preserves_faces_and_increases_elements(self):
        mesh=generate_mesh({'step':self.step,'size':5,'refinements':[{'faceId':self.right,'size':2}]},self.folder)
        self.assertGreater(len(mesh['tetrahedra']),len(self.mesh['tetrahedra']))
        self.assertEqual([f['id'] for f in mesh['faces']],[f['id'] for f in self.mesh['faces']])
        self.assertGreater(mesh['quality']['minimum'],0)
    def test_bending_convergence(self):
        study=self.study();study['material']['poisson']=0.3;study['loads'][0]['vector']=[0,0,-10]
        coarse=solve(self.mesh,study,self.folder)['summary']['maxDisplacement']
        fine_mesh=generate_mesh({'step':self.step,'size':2.5,'refinements':[]},self.folder)
        fine=solve(fine_mesh,study,self.folder)['summary']['maxDisplacement']
        analytic=10*100**3/(3*210000*(10*10**3/12))
        print('Bending:',coarse,fine,'Euler-Bernoulli:',analytic)
        self.assertGreater(fine,coarse)
        self.assertLess(abs(fine-analytic)/analytic,0.25)
    def test_bonded_assembly_transfers_load_across_interface(self):
        mesh=generate_mesh({'step':assembly_step(self.folder),'size':5,'geometryMode':'assemblyBonded'},self.folder)
        self.assertEqual(mesh['bodyCount'],1)
        self.assertAlmostEqual(mesh['volume'],10000,places=5)
        study=self.study()
        study['supports'][0]['faceIds']=[min(mesh['faces'],key=lambda f:f['center'][0])['id']]
        study['loads'][0]['faceIds']=[max(mesh['faces'],key=lambda f:f['center'][0])['id']]
        result=solve(mesh,study,self.folder)['summary']
        self.assertAlmostEqual(result['maxDisplacement']/(1000*100/(100*210000)),1,places=4)
        self.assertAlmostEqual(result['maxVonMises'],10,places=3)
        np.testing.assert_allclose(result['reaction'],[-1000,0,0],atol=.02)
    def test_separated_assembly_requires_supports_for_each_body(self):
        mesh=generate_mesh({'step':assembly_step(self.folder,True),'size':5,'geometryMode':'assemblyBonded'},self.folder)
        self.assertEqual(mesh['bodyCount'],2)
        study=self.study()
        left=min(mesh['faces'],key=lambda f:f['center'][0])['id']
        right=max(mesh['faces'],key=lambda f:f['center'][0])['id']
        study['supports'][0]['faceIds']=[left]
        study['loads'][0]['faceIds']=[right]
        with self.assertRaisesRegex(ValueError,'corpo rígido'):prepare_analysis(mesh,study)
        other_left=next(f['id'] for f in mesh['faces'] if abs(f['center'][0]-60)<1e-6)
        study['supports'][0]['faceIds'].append(other_left)
        result=solve(mesh,study,self.folder)['summary']
        self.assertAlmostEqual(result['maxDisplacement']/(1000*50/(100*210000)),1,places=4)
        np.testing.assert_allclose(result['reaction'],[-1000,0,0],atol=.02)
    def test_edge_only_connection_is_rejected(self):
        with self.assertRaisesRegex(ValueError,'aresta ou ponto'):connected_bodies([[0,1,2,3],[0,1,4,5]])
    def test_multiple_solids_rejected(self):
        gmsh.initialize(['test','-nopopup']);gmsh.option.setNumber('General.Terminal',0)
        try:
            gmsh.model.occ.addBox(0,0,0,1,1,1);gmsh.model.occ.addBox(3,0,0,1,1,1);gmsh.model.occ.synchronize();gmsh.write(str(self.folder/'two.step'))
        finally:gmsh.finalize()
        with self.assertRaisesRegex(ValueError,'exatamente um sólido'):generate_mesh({'step':(self.folder/'two.step').read_text(),'size':1},self.folder)

if __name__=='__main__':unittest.main(verbosity=2)

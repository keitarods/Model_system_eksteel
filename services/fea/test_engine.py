import os
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path
import gmsh
import numpy as np
from engine import generate_mesh, prepare_analysis, solve, connected_bodies, mesh_options


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


class MeshingErrorTests(unittest.TestCase):
    def test_intersection_reports_actionable_error_and_releases_runtime(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            step = box_step(folder)
            error = Exception('PLC Error:  A segment and a facet intersect at point')
            with patch.object(gmsh.model.mesh, 'generate', side_effect=error):
                with self.assertRaisesRegex(ValueError, 'interseções entre arestas e faces') as caught:
                    generate_mesh({'step': step, 'size': 5}, folder)
            self.assertIs(caught.exception.__cause__, error)
            self.assertEqual(gmsh.isInitialized(), 0)

    def test_unexpected_failure_is_not_misreported_as_geometry_intersection(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            step = box_step(folder)
            error = RuntimeError('Unexpected meshing failure')
            with patch.object(gmsh.model.mesh, 'generate', side_effect=error):
                with self.assertRaises(RuntimeError) as caught:
                    generate_mesh({'step': step, 'size': 5}, folder)
            self.assertIs(caught.exception, error)
            self.assertEqual(gmsh.isInitialized(), 0)


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
        stages=[]
        result=solve(self.mesh,self.study(),self.folder,lambda p,s:stages.append((p,s)))
        self.assertEqual(stages[0][0],5)
        self.assertGreater(stages[-1][0],80)
        self.assertLess(stages[-1][0],100)
        self.assertEqual([p for p,_ in stages],sorted(p for p,_ in stages))
        expected=1000*100/(100*210000)
        self.assertAlmostEqual(result['summary']['maxDisplacement']/expected,1,places=4)
        self.assertAlmostEqual(result['summary']['maxVonMises'],10,places=3)
        np.testing.assert_allclose(result['summary']['reaction'],[-1000,0,0],atol=0.02)
        self.assertLess(result['summary']['balanceError'],0.02)
        self.assertLess(result['summary']['momentBalanceError'],0.1)
    def test_preparation_and_quality_report(self):
        mesh=generate_mesh({'step':self.step,'size':5,
            'preparation':{'heal':True,'removeSmall':True,'tolerance':0.001},
            'meshControls':{'minimumSize':2,'curvature':16,'qualityTarget':0.4}},self.folder)
        self.assertEqual(mesh['preparationReport']['preparedBodies'],1)
        self.assertAlmostEqual(mesh['preparationReport']['volumeChangePercent'],0,places=6)
        self.assertGreater(mesh['quality']['p05'],0)
        self.assertGreaterEqual(mesh['quality']['belowTarget'],0)

    def test_microgap_union(self):
        gmsh.initialize(['test','-nopopup']);gmsh.option.setNumber('General.Terminal',0)
        try:
            gmsh.model.occ.addBox(0,0,0,50,10,10)
            gmsh.model.occ.addBox(50.0001,0,0,50,10,10)
            gmsh.model.occ.synchronize();gmsh.write(str(self.folder/'gap.step'))
        finally:gmsh.finalize()
        payload={'step':(self.folder/'gap.step').read_text(),'size':5,'geometryMode':'assemblyBonded'}
        self.assertEqual(generate_mesh(payload,self.folder)['bodyCount'],2)
        payload['preparation']={'unite':True,'closeGaps':True,'tolerance':0.001}
        mesh=generate_mesh(payload,self.folder)
        self.assertEqual(mesh['bodyCount'],1)
        self.assertLess(abs(mesh['preparationReport']['volumeChangePercent']),0.01)

    def test_curvature_refines_cylinder(self):
        gmsh.initialize(['test','-nopopup']);gmsh.option.setNumber('General.Terminal',0)
        try:
            gmsh.model.occ.addCylinder(0,0,0,0,0,20,5)
            gmsh.model.occ.synchronize();gmsh.write(str(self.folder/'cylinder.step'))
        finally:gmsh.finalize()
        payload={'step':(self.folder/'cylinder.step').read_text(),'size':5}
        coarse=generate_mesh(payload,self.folder)
        payload['meshControls']={'minimumSize':0.5,'curvature':32}
        fine=generate_mesh(payload,self.folder)
        self.assertGreater(len(fine['tetrahedra']),len(coarse['tetrahedra']))
        self.assertEqual([f['id'] for f in fine['faces']],[f['id'] for f in coarse['faces']])

    def test_invalid_meshing_controls(self):
        for payload in ({'meshControls':{'minimumSize':20}},
                        {'preparation':{'heal':'yes'}},
                        {'preparation':{'tolerance':float('nan')}},
                        {'meshControls':{'qualityTarget':2}}):
            with self.assertRaises(ValueError):mesh_options(payload,5)

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

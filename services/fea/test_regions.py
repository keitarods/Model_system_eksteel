import tempfile
import unittest
from pathlib import Path
import numpy as np
import gmsh
from engine import generate_mesh, solve, prepare_analysis
from test_engine import assembly_step

class RegionTests(unittest.TestCase):
    def test_two_material_bar(self):
        with tempfile.TemporaryDirectory() as temp:
            folder=Path(temp)
            mesh=generate_mesh({'step':assembly_step(folder),'size':5,'geometryMode':'assemblyBonded','materialMode':'regions','elementType':'C3D10'},folder)
            self.assertEqual(len(mesh['regions']),2)
            self.assertEqual(mesh['bodyCount'],1)
            self.assertEqual(sorted(e for r in mesh['regions'] for e in r['elements']),list(range(len(mesh['tetrahedra']))))
            steel={'young':210000,'poisson':0,'density':7850,'yieldStress':250}
            alloy={'young':70000,'poisson':0,'density':2700,'yieldStress':100}
            region=max(mesh['regions'],key=lambda r:r['center'][0])
            study={'material':steel,'regionMaterials':{str(region['id']):alloy},'supports':[{'faceIds':[min(mesh['faces'],key=lambda f:f['center'][0])['id']],'axes':[True]*3}], 'loads':[{'kind':'force','faceIds':[max(mesh['faces'],key=lambda f:f['center'][0])['id']],'vector':[1000,0,0]}]}
            result=solve(mesh,study,folder)
            expected=1000/100*(50/210000+50/70000)
            self.assertAlmostEqual(result['summary']['maxDisplacement'],expected,places=8)
            self.assertAlmostEqual(result['summary']['minSafetyFactor'],10,places=3)
            np.testing.assert_allclose(result['summary']['reaction'],[-1000,0,0],atol=.02)
            study['loads']=[{'kind':'gravity','vector':[0,0,-10]}]
            _,_,forces,_=prepare_analysis(mesh,study)
            self.assertAlmostEqual(forces.sum(axis=0)[2],-(7850+2700)*5000*1e-9*10,places=9)
            study['regionMaterials']['999']=alloy
            with self.assertRaisesRegex(ValueError,'inexistente'):prepare_analysis(mesh,study)

    def test_overlapping_material_regions_are_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            folder=Path(temp)
            gmsh.initialize(['test','-nopopup']);gmsh.option.setNumber('General.Terminal',0)
            try:
                gmsh.model.occ.addBox(0,0,0,10,10,10)
                gmsh.model.occ.addBox(5,0,0,10,10,10)
                gmsh.model.occ.synchronize();gmsh.write(str(folder/'overlap.step'))
            finally:gmsh.finalize()
            with self.assertRaisesRegex(ValueError,'ambíguo'):
                generate_mesh({'step':(folder/'overlap.step').read_text(),'size':5,'geometryMode':'assemblyBonded','materialMode':'regions'},folder)

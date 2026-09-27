"""Single-solid or bonded assembly, small displacement, isotropic linear elasticity. Units: mm, N, MPa.
Gmsh C3D4 mesh; CalculiX solves displacements; element stresses recovered from B*u.
"""
import math
import os
import subprocess
import numpy as np

MAX_NODES = 30000
MAX_ELEMENTS = 100000


def number(value, label, minimum=None, maximum=None):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f'{label}: número inválido.')
    if minimum is not None and value < minimum or maximum is not None and value > maximum:
        raise ValueError(f'{label}: valor fora do intervalo permitido.')
    return float(value)


def vector(value, label):
    if not isinstance(value, list) or len(value) != 3:
        raise ValueError(f'{label}: informe X, Y e Z.')
    return np.array([number(v, label, -1e15, 1e15) for v in value])


def connected_bodies(tetrahedra):
    """Face-connected tetrahedra; edge/point-only contact is not a bonded interface."""
    parents = list(range(len(tetrahedra)))
    def root(index):
        while parents[index] != index:
            parents[index] = parents[parents[index]]
            index = parents[index]
        return index
    faces = {}
    for index, tet in enumerate(tetrahedra):
        for opposite in range(4):
            face = tuple(sorted(tet[k] for k in range(4) if k != opposite))
            previous = faces.get(face)
            if previous is not None:
                parents[root(index)] = root(previous)
            else:
                faces[face] = index
    groups = {}
    for index, tet in enumerate(tetrahedra):
        groups.setdefault(root(index), set()).update(tet)
    assigned = set()
    for nodes in groups.values():
        if assigned.intersection(nodes):
            raise ValueError('Há corpos ligados apenas por aresta ou ponto. Use interfaces com área de contato para união contínua.')
        assigned.update(nodes)
    return [sorted(nodes) for nodes in groups.values()]


def generate_mesh(payload, folder):
    import gmsh
    step = payload.get('step', '')
    if not isinstance(step, str) or 'ISO-10303-21;' not in step or len(step.encode()) > 12_000_000:
        raise ValueError('Informe uma geometria STEP válida de até 12 MB.')
    mode = payload.get('geometryMode', 'part')
    if mode not in ('part', 'assemblyBonded'):
        raise ValueError('Tipo de geometria inválido.')
    size = number(payload.get('size'), 'Tamanho da malha', 0.01, 1e6)
    refinements = payload.get('refinements', [])
    if not isinstance(refinements, list) or len(refinements) > 100:
        raise ValueError('Refinamentos inválidos.')
    source = folder / 'model.step'
    source.write_text(step)
    gmsh.initialize(['fea', '-nopopup'])
    try:
        gmsh.option.setNumber('General.Terminal', 0)
        gmsh.option.setNumber('General.NumThreads', 1)
        gmsh.option.setString('Geometry.OCCTargetUnit', 'MM')
        gmsh.model.occ.importShapes(str(source))
        gmsh.model.occ.synchronize()
        volumes = gmsh.model.getEntities(3)
        if not volumes:
            raise ValueError('A geometria não contém sólidos.')
        if mode == 'part' and len(volumes) != 1:
            raise ValueError('O modo peça exige exatamente um sólido. Para conjuntos, use Importar montagem.')
        if mode == 'assemblyBonded' and len(volumes) > 1:
            gmsh.model.occ.fuse(volumes[:1], volumes[1:])
            gmsh.model.occ.synchronize()
            volumes = gmsh.model.getEntities(3)
            if not volumes:
                raise ValueError('Não foi possível unir os componentes da montagem.')
        face_tags = sorted(set(tag for dim, tag in gmsh.model.getBoundary(volumes, oriented=False) if dim == 2))
        gmsh.option.setNumber('Mesh.MeshSizeMin', size)
        gmsh.option.setNumber('Mesh.MeshSizeMax', size)
        gmsh.option.setNumber('Mesh.ElementOrder', 1)
        gmsh.option.setNumber('Mesh.MeshSizeFromCurvature', 0)
        gmsh.model.mesh.setSize(gmsh.model.getEntities(0), size)
        fields = []
        min_size = size
        for refinement in refinements:
            tag = refinement.get('faceId')
            if tag not in face_tags:
                raise ValueError('Uma face de refinamento não pertence à geometria.')
            local = number(refinement.get('size'), 'Refinamento', 0.01, size)
            min_size = min(min_size, local)
            distance = gmsh.model.mesh.field.add('Distance')
            gmsh.model.mesh.field.setNumbers(distance, 'FacesList', [tag])
            gmsh.model.mesh.field.setNumber(distance, 'Sampling', 100)
            threshold = gmsh.model.mesh.field.add('Threshold')
            for key, val in {'InField': distance, 'SizeMin': local, 'SizeMax': size, 'DistMin': local, 'DistMax': size * 3}.items():
                gmsh.model.mesh.field.setNumber(threshold, key, val)
            fields.append(threshold)
        gmsh.option.setNumber('Mesh.MeshSizeMin', min_size)
        if fields:
            field = gmsh.model.mesh.field.add('Min')
            gmsh.model.mesh.field.setNumbers(field, 'FieldsList', fields)
            gmsh.model.mesh.field.setAsBackgroundMesh(field)
        gmsh.model.mesh.generate(3)
        gmsh.model.mesh.optimize('Netgen')
        tags, xyz, _ = gmsh.model.mesh.getNodes()
        types, element_tags, connectivity = gmsh.model.mesh.getElements(3)
        if list(types) != [4]:
            raise ValueError('A malha deve conter apenas tetraedros lineares.')
        raw_tets = np.array(connectivity[0], dtype=int).reshape(-1, 4)
        if len(tags) > MAX_NODES or len(raw_tets) > MAX_ELEMENTS:
            raise ValueError('Malha acima do limite (30 mil nós / 100 mil elementos). Aumente o tamanho.')
        used = sorted(set(raw_tets.flatten().tolist()))
        lookup = {tag: i for i, tag in enumerate(used)}
        coordinates = {int(tag): list(xyz[i*3:i*3+3]) for i, tag in enumerate(tags)}
        nodes = np.array([coordinates[tag] for tag in used])
        tetrahedra = [[lookup[int(n)] for n in tet] for tet in raw_tets]
        owners = {}
        for index, tet in enumerate(tetrahedra):
            for opposite in range(4):
                tri = [tet[k] for k in range(4) if k != opposite]
                key = tuple(sorted(tri))
                owners[key] = (index, tet[opposite]) if key not in owners else None
        faces = []
        for tag in face_tags:
            surface_types, _, surface_nodes = gmsh.model.mesh.getElements(2, tag)
            triangles = []
            elements = []
            for kind, conn in zip(surface_types, surface_nodes):
                if int(kind) != 2:
                    raise ValueError('Superfície de malha incompatível.')
                for raw in np.array(conn).reshape(-1, 3):
                    tri = [lookup[int(n)] for n in raw]
                    owner = owners.get(tuple(sorted(tri)))
                    if owner is None:
                        raise ValueError('Superfície sem elemento volumétrico correspondente.')
                    a, b, c = nodes[tri]
                    if np.dot(np.cross(b-a, c-a), nodes[owner[1]]-a) > 0:
                        tri[1], tri[2] = tri[2], tri[1]
                    triangles.append(tri)
                    elements.append(owner[0])
            faces.append({'id': tag, 'triangles': triangles, 'elements': elements, 'area': float(gmsh.model.occ.getMass(2, tag)), 'center': list(gmsh.model.occ.getCenterOfMass(2, tag))})
        bodies = connected_bodies(tetrahedra)
        quality = np.array(gmsh.model.mesh.getElementQualities(element_tags[0], 'minSICN'))
        if not len(quality) or float(quality.min()) <= 1e-8:
            raise ValueError('Malha contém elementos degenerados. Revise geometria e refinamento.')
        return {'nodes': nodes.tolist(), 'tetrahedra': tetrahedra, 'faces': faces, 'quality': {'minimum': float(quality.min()), 'mean': float(quality.mean())}, 'geometryMode': mode, 'bodyCount': len(bodies), 'volume': float(sum(gmsh.model.occ.getMass(3, tag) for _, tag in volumes)), 'size': size, 'refinements': refinements, 'elementType': 'C3D4'}
    finally:
        gmsh.finalize()


def constitutive(young, poisson):
    lam = young * poisson / ((1+poisson)*(1-2*poisson))
    mu = young / (2*(1+poisson))
    matrix = np.zeros((6, 6))
    matrix[:3, :3] = lam
    matrix[:3, :3] += np.eye(3)*2*mu
    matrix[3:, 3:] = np.eye(3)*mu
    return matrix


def element_matrix(points):
    coordinates = np.column_stack((np.ones(4), points))
    volume = abs(np.linalg.det(coordinates))/6
    if volume < 1e-15:
        raise ValueError('Elemento degenerado.')
    gradients = np.linalg.inv(coordinates)[1:, :]
    b = np.zeros((6, 12))
    for i in range(4):
        x, y, z = gradients[:, i]
        b[:, 3*i:3*i+3] = [[x,0,0],[0,y,0],[0,0,z],[y,x,0],[0,z,y],[z,0,x]]
    return b, volume


def prepare_analysis(mesh, study):
    material = study.get('material', {})
    young = number(material.get('young'), 'Módulo de elasticidade (MPa)', 1e-6, 1e9)
    poisson = number(material.get('poisson'), 'Poisson', -0.99, 0.49)
    density = number(material.get('density'), 'Densidade (kg/m³)', 0, 1e6)
    number(material.get('yieldStress'), 'Limite de escoamento (MPa)', 1e-6, 1e9)
    nodes = np.array(mesh['nodes'])
    faces = {face['id']: face for face in mesh['faces']}
    loads = study.get('loads', [])
    supports = study.get('supports', [])
    if not isinstance(loads, list) or not isinstance(supports, list) or len(loads)>100 or len(supports)>100:
        raise ValueError('Lista de cargas ou apoios inválida.')
    def selected(entry):
        ids = entry.get('faceIds')
        if not isinstance(ids, list) or not ids or any(isinstance(i,bool) or not isinstance(i,int) or i not in faces for i in ids):
            raise ValueError('Selecione faces válidas da malha.')
        return [faces[tag] for tag in set(ids)]
    fixed = set()
    for support in supports:
        axes = support.get('axes')
        if not isinstance(axes, list) or len(axes)!=3 or any(type(a) is not bool for a in axes) or not any(axes):
            raise ValueError('Selecione pelo menos uma direção de fixação.')
        for face in selected(support):
            for tri in face['triangles']:
                fixed.update(3*n+axis for n in tri for axis in range(3) if axes[axis])
    # Each disconnected body needs its own restraints. A global rank check
    # would wrongly accept an assembly with one supported and one free part.
    for index, body in enumerate(connected_bodies(mesh['tetrahedra'])):
        body_nodes = nodes[body]
        center = body_nodes.mean(axis=0)
        scale = max(float(np.linalg.norm(np.ptp(body_nodes, axis=0))), 1e-12)
        rigid = []
        for node in body:
            x,y,z = (nodes[node]-center)/scale
            modes = np.array([[1,0,0,0,z,-y],[0,1,0,-z,0,x],[0,0,1,y,-x,0]])
            for axis in range(3):
                if 3*node+axis in fixed:
                    rigid.append(modes[axis])
        if not rigid or np.linalg.matrix_rank(rigid, tol=1e-9)<6:
            location = ', '.join(f'{v:.2f}' for v in center)
            raise ValueError(f'Fixações insuficientes no corpo {index+1} (centro: {location} mm): ainda há movimento de corpo rígido. Corpos separados precisam de apoios próprios.')
    forces = np.zeros_like(nodes)
    for load in loads:
        kind = load.get('kind')
        if kind=='gravity':
            acceleration = vector(load.get('vector'), 'Gravidade (m/s²)')
            for tet in mesh['tetrahedra']:
                _, volume = element_matrix(nodes[tet])
                forces[tet] += density*1e-9*volume/4*acceleration
        elif kind in ('force','pressure'):
            triangles = [tri for face in selected(load) for tri in face['triangles']]
            areas = [np.cross(nodes[t[1]]-nodes[t[0]],nodes[t[2]]-nodes[t[0]])/2 for t in triangles]
            total_area = sum(np.linalg.norm(a) for a in areas)
            if total_area<=0: raise ValueError('Área carregada inválida.')
            force = vector(load.get('vector'), 'Força (N)') if kind=='force' else None
            pressure = number(load.get('pressure'), 'Pressão (MPa)', -1e9, 1e9) if kind=='pressure' else None
            for tri, area_vector in zip(triangles, areas):
                traction = force*np.linalg.norm(area_vector)/total_area if kind=='force' else -pressure*area_vector
                forces[tri] += traction/3
        else:
            raise ValueError('Tipo de carga inválido.')
    if np.linalg.norm(forces) < 1e-12:
        raise ValueError('Adicione pelo menos uma carga não nula.')
    return nodes, fixed, forces, constitutive(young,poisson)


def write_deck(mesh, study, folder):
    nodes, fixed, forces, _ = prepare_analysis(mesh, study)
    material = study['material']
    lines = ['*HEADING', 'Eksteel static linear - mm N MPa', '*NODE, NSET=NALL']
    lines += [f'{i+1}, '+', '.join(f'{v:.12g}' for v in p) for i,p in enumerate(nodes)]
    lines += ['*ELEMENT, TYPE=C3D4, ELSET=EALL']
    for i,t in enumerate(mesh['tetrahedra']):
        ordered = list(t)
        if np.linalg.det(np.column_stack((np.ones(4),nodes[ordered])))<0:
            ordered[1],ordered[2] = ordered[2],ordered[1]
        lines.append(f'{i+1}, '+', '.join(str(n+1) for n in ordered))
    lines += ['*MATERIAL, NAME=MAT', '*ELASTIC', f"{material['young']}, {material['poisson']}", '*SOLID SECTION, ELSET=EALL, MATERIAL=MAT', '*BOUNDARY']
    lines += [f'{d//3+1}, {d%3+1}, {d%3+1}' for d in sorted(fixed)]
    lines += ['*STEP', '*STATIC', '*CLOAD']
    for i, force in enumerate(forces):
        lines += [f'{i+1}, {axis+1}, {value:.12g}' for axis,value in enumerate(force) if abs(value)>1e-20]
    lines += ['*NODE PRINT, NSET=NALL', 'U', '*END STEP']
    (folder/'analysis.inp').write_text('\n'.join(lines)+'\n')


def parse_displacements(text, count):
    result = np.full((count,3), np.nan)
    active = False
    for line in text.splitlines():
        if 'displacements' in line.lower() and 'set' in line.lower():
            active = True
            continue
        if not active: continue
        fields = line.split()
        if len(fields)==4 and fields[0].isdigit():
            index = int(fields[0])-1
            if index<0 or index>=count: raise ValueError('Nó inválido na saída do solver.')
            result[index] = [float(v.replace('D','E')) for v in fields[1:]]
    if not np.isfinite(result).all():
        raise ValueError('O solver não retornou deslocamentos completos. Verifique apoios e geometria.')
    return result


def recover_results(mesh, study, displacement):
    nodes, fixed, forces, d = prepare_analysis(mesh, study)
    internal = np.zeros_like(nodes)
    # CalculiX .dat prints 7 significant digits. Bound force-recovery error
    # from that quantization instead of rejecting valid stiff/slender models.
    precision = np.zeros_like(displacement)
    nonzero = displacement != 0
    precision[nonzero] = 0.51 * 10.0**(np.floor(np.log10(np.abs(displacement[nonzero]))) - 6)
    uncertainty = np.zeros_like(nodes)
    stresses=[]
    strains=[]
    vm=[]
    nodal_vm=np.zeros(len(nodes))
    weights=np.zeros(len(nodes))
    for tet in mesh['tetrahedra']:
        b,vol=element_matrix(nodes[tet])
        strain=b@displacement[tet].reshape(-1)
        stress=d@strain
        internal[tet]+=(b.T@stress*vol).reshape(4,3)
        uncertainty[tet]+=(np.abs(b.T@d@b)*vol@precision[tet].reshape(-1)).reshape(4,3)
        s1,s2,s3,t12,t23,t31=stress
        equivalent=float(np.sqrt(((s1-s2)**2+(s2-s3)**2+(s3-s1)**2)/2+3*(t12*t12+t23*t23+t31*t31)))
        stresses.append(stress.tolist());strains.append(strain.tolist());vm.append(equivalent)
        nodal_vm[tet]+=equivalent*vol;weights[tet]+=vol
    residual=internal-forces
    reactions=np.zeros_like(nodes)
    for dof in fixed: reactions[dof//3,dof%3]=residual[dof//3,dof%3]
    balance=reactions.sum(axis=0)+forces.sum(axis=0)
    free = residual.reshape(-1).copy()
    free[list(fixed)] = 0
    reference=max(float(np.linalg.norm(forces)),1e-9)
    unexplained = np.maximum(np.abs(free)-uncertainty.reshape(-1),0)
    if np.linalg.norm(unexplained)>reference*1e-4 or np.linalg.norm(balance)>max(reference, float(np.linalg.norm(forces.sum(axis=0))))*0.01:
        raise ValueError('A solução não passou na verificação de equilíbrio. Revise a malha e as fixações.')
    magnitude=np.linalg.norm(displacement,axis=1)
    return {'displacements':displacement.tolist(), 'displacementMagnitude':magnitude.tolist(), 'elementStress':stresses, 'elementStrain':strains, 'elementVonMises':vm, 'nodalVonMises':(nodal_vm/weights).tolist(), 'reactions':reactions.tolist(), 'summary':{'maxDisplacement':float(magnitude.max()), 'maxVonMises':max(vm), 'minSafetyFactor':float(study['material']['yieldStress']/max(vm)) if max(vm)>1e-12 else None, 'reaction':reactions.sum(axis=0).tolist(), 'appliedForce':forces.sum(axis=0).tolist(), 'balanceError':float(np.linalg.norm(balance)), 'freeResidualRelative':float(np.linalg.norm(free)/reference)}, 'solver':'CalculiX', 'elementType':'C3D4'}


def solve(mesh, study, folder):
    write_deck(mesh, study, folder)
    env={**os.environ, 'OMP_NUM_THREADS':'1', 'CCX_NPROC_RESULTS':'1', 'CCX_NPROC_EQUATION_SOLVER':'1'}
    binary=os.environ.get('CCX_BIN','ccx')
    with (folder/'solver.log').open('w') as output:
        completed=subprocess.run([binary,'-i','analysis'],cwd=folder,env=env,stdout=output,stderr=subprocess.STDOUT,timeout=180)
    log=(folder/'solver.log').read_text(errors='replace')
    if completed.returncode or '*ERROR' in log.upper() or not (folder/'analysis.dat').exists():
        raise ValueError('CalculiX não concluiu a análise. Revise material, malha e apoios.')
    displacement=parse_displacements((folder/'analysis.dat').read_text(),len(mesh['nodes']))
    return recover_results(mesh, study, displacement)

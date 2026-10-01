"""Single-solid or bonded assembly, small displacement, isotropic linear elasticity. Units: mm, N, MPa.
Gmsh mesh with C3D4/C3D10 interpolation; CalculiX solves displacements.
Region materials and consistent quadrature recover stresses, reactions and energy.
"""
import math
import os
import subprocess
import numpy as np
from unilateral import spring_lines, solve_incremental, recover_unilateral
from contacts import build_bonds, bonded_groups, equation_lines, recover_bonds
from elements import elevate_mesh, integration, positive_order, von_mises

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


def mesh_options(payload, size):
    preparation = payload.get('preparation', {})
    controls = payload.get('meshControls', {})
    if not isinstance(preparation, dict) or not isinstance(controls, dict):
        raise ValueError('Opções de preparação ou malha inválidas.')
    for key in ('heal', 'removeSmall', 'closeGaps', 'unite'):
        if key in preparation and type(preparation[key]) is not bool:
            raise ValueError('Opção de preparação inválida.')
    tolerance = number(preparation.get('tolerance', 0.001), 'Tolerância geométrica', 1e-7, 1)
    minimum = number(controls.get('minimumSize', size), 'Tamanho mínimo', 0.01, size)
    curvature = number(controls.get('curvature', 0), 'Divisões por curvatura', 0, 100)
    quality = number(controls.get('qualityTarget', 0.3), 'Qualidade alvo', 0.01, 0.9)
    return preparation, tolerance, minimum, curvature, quality


def generate_mesh(payload, folder):
    import gmsh
    step = payload.get('step', '')
    if not isinstance(step, str) or 'ISO-10303-21;' not in step or len(step.encode()) > 12_000_000:
        raise ValueError('Informe uma geometria STEP válida de até 12 MB.')
    material_mode = payload.get('materialMode', 'uniform')
    if material_mode not in ('uniform','regions'):
        raise ValueError('Modo de materiais inválido.')
    mode = payload.get('geometryMode', 'part')
    if mode not in ('part', 'assemblyBonded'):
        raise ValueError('Tipo de geometria inválido.')
    element_type = payload.get('elementType', 'C3D4')
    if element_type not in ('C3D4', 'C3D10'):
        raise ValueError('Tipo de elemento inválido.')
    size = number(payload.get('size'), 'Tamanho da malha', 0.01, 1e6)
    preparation, tolerance, minimum, curvature, quality_target = mesh_options(payload, size)
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
        if material_mode == 'regions' and len(volumes)>128:
            raise ValueError('O modo de materiais por corpo permite até 128 sólidos.')
        original_count = len(volumes)
        original_volume = sum(gmsh.model.occ.getMass(3, tag) for _, tag in volumes)
        if mode == 'part' and len(volumes) != 1 and not preparation.get('unite'):
            raise ValueError('O modo peça exige exatamente um sólido. Para conjuntos, use Importar montagem.')
        if preparation.get('heal') or preparation.get('removeSmall'):
            gmsh.model.occ.healShapes(volumes, tolerance=tolerance,
                fixDegenerated=True, fixSmallEdges=preparation.get('removeSmall', False),
                fixSmallFaces=preparation.get('removeSmall', False), sewFaces=True, makeSolids=True)
            gmsh.model.occ.synchronize()
            volumes = gmsh.model.getEntities(3)
            if not volumes:
                raise ValueError('O reparo não preservou sólidos. Reduza a tolerância.')
        if preparation.get('closeGaps'):
            gmsh.option.setNumber('Geometry.ToleranceBoolean', tolerance)
        unite = preparation.get('unite', mode == 'assemblyBonded')
        if preparation.get('closeGaps') and not unite:
            raise ValueError('Fechar microfolgas exige a união dos corpos.')
        volumes = sorted(volumes)
        region_volumes = {i+1:[v] for i,v in enumerate(volumes)}
        if unite and len(volumes) > 1:
            if material_mode == 'regions':
                _, mapping = gmsh.model.occ.fragment(volumes[:1], volumes[1:])
                region_volumes = {i+1:[v for v in mapped if v[0]==3] for i,mapped in enumerate(mapping)}
                seen = set()
                for mapped in region_volumes.values():
                    if not mapped or seen.intersection(mapped):
                        raise ValueError('Corpos sobrepostos tornam o material ambíguo. Remova a sobreposição ou use material comum.')
                    seen.update(mapped)
            else:
                gmsh.model.occ.fuse(volumes[:1], volumes[1:])
            gmsh.model.occ.synchronize()
            volumes = gmsh.model.getEntities(3)
            if not volumes:
                raise ValueError('Não foi possível unir os componentes da montagem.')
        prepared_volume = sum(gmsh.model.occ.getMass(3, tag) for _, tag in volumes)
        report = {'originalBodies': original_count, 'preparedBodies': len(volumes),
                  'originalVolume': float(original_volume), 'preparedVolume': float(prepared_volume),
                  'volumeChangePercent': float(100 * (prepared_volume-original_volume)/original_volume),
                  'tolerance': tolerance}
        face_tags = sorted(set(tag for dim, tag in gmsh.model.getBoundary(volumes, oriented=False) if dim == 2))
        gmsh.option.setNumber('Mesh.MeshSizeMin', size)
        gmsh.option.setNumber('Mesh.MeshSizeMax', size)
        gmsh.option.setNumber('Mesh.ElementOrder', 1)
        gmsh.option.setNumber('Mesh.MeshSizeFromCurvature', curvature)
        gmsh.option.setNumber('Mesh.OptimizeThreshold', quality_target)
        gmsh.model.mesh.setSize(gmsh.model.getEntities(0), size)
        fields = []
        min_size = minimum
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
        gmsh.model.mesh.optimize('')
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
        regions = []
        if material_mode == 'regions':
            element_lookup = {int(tag):i for i,tag in enumerate(element_tags[0])}
            for region_id, entities in region_volumes.items():
                indices = []
                mass = sum(gmsh.model.occ.getMass(3,tag) for _,tag in entities)
                center = sum(np.array(gmsh.model.occ.getCenterOfMass(3,tag))*gmsh.model.occ.getMass(3,tag) for _,tag in entities)/mass
                for _,tag in entities:
                    _, regional_tags, _ = gmsh.model.mesh.getElements(3,tag)
                    indices.extend(element_lookup[int(e)] for tags_in_type in regional_tags for e in tags_in_type)
                regions.append({'id':region_id,'elements':indices,'volume':float(mass),'center':center.tolist()})
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
        if element_type == 'C3D10':
            nodes, tetrahedra = elevate_mesh(nodes, tetrahedra, faces)
            if len(nodes) > MAX_NODES:
                raise ValueError('Malha quadrática acima do limite de 30 mil nós. Aumente o tamanho.')
        bodies = connected_bodies(tetrahedra)
        body_of = {n:i+1 for i,body in enumerate(bodies) for n in body}
        for face in faces:
            face['bodyId'] = body_of[face['triangles'][0][0]]
            points = nodes[np.array(face['triangles'])]
            normal = np.cross(points[:,1]-points[:,0], points[:,2]-points[:,0]).sum(axis=0)
            face['normal'] = (normal/max(float(np.linalg.norm(normal)),1e-30)).tolist()
        quality = np.array(gmsh.model.mesh.getElementQualities(element_tags[0], 'minSICN'))
        if not len(quality) or float(quality.min()) <= 1e-8:
            raise ValueError('Malha contém elementos degenerados. Revise geometria e refinamento.')
        return {'regions': regions, 'preparationReport': report, 'nodes': nodes.tolist(), 'tetrahedra': tetrahedra, 'faces': faces, 'quality': {'minimum': float(quality.min()), 'mean': float(quality.mean()), 'p05': float(np.percentile(quality, 5)), 'belowTarget': int(np.sum(quality < quality_target)), 'target': quality_target}, 'geometryMode': mode, 'bodyCount': len(bodies), 'volume': float(sum(gmsh.model.occ.getMass(3, tag) for _, tag in volumes)), 'size': size, 'refinements': refinements, 'elementType': element_type}
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


def element_materials(mesh, study):
    overrides = study.get('regionMaterials', {})
    if not isinstance(overrides, dict):
        raise ValueError('Materiais por corpo inválidos.')
    regions = mesh.get('regions', [])
    if any(key not in {str(r['id']) for r in regions} for key in overrides):
        raise ValueError('Material referencia um corpo inexistente.')
    materials = [study.get('material', {}) for _ in mesh['tetrahedra']]
    for region in regions:
        material = overrides.get(str(region['id']), study.get('material', {}))
        for index in region['elements']:
            materials[index] = material
    checked = set()
    for material in materials:
        if not isinstance(material, dict):
            raise ValueError('Material inválido.')
        if id(material) in checked:
            continue
        checked.add(id(material))
        number(material.get('young'), 'Módulo de elasticidade', 1e-6, 1e9)
        number(material.get('poisson'), 'Poisson', -0.99, .49)
        number(material.get('density'), 'Densidade', 0, 1e6)
        number(material.get('yieldStress'), 'Escoamento', 1e-6, 1e9)
    return materials


def prepare_analysis(mesh, study):
    material = study.get('material', {})
    young = number(material.get('young'), 'Módulo de elasticidade (MPa)', 1e-6, 1e9)
    poisson = number(material.get('poisson'), 'Poisson', -0.99, 0.49)
    density = number(material.get('density'), 'Densidade (kg/m³)', 0, 1e6)
    number(material.get('yieldStress'), 'Limite de escoamento (MPa)', 1e-6, 1e9)
    materials = element_materials(mesh, study)
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
    bodies = connected_bodies(mesh['tetrahedra'])
    bonds = build_bonds(mesh, study, bodies, fixed)
    # A fully bonded planar face removes the relative rigid modes. Each group
    # still needs six independent restraints; unrelated bodies stay separate.
    for index, body in enumerate(bonded_groups(bodies, bonds)):
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
            for index, tet in enumerate(mesh['tetrahedra']):
                density = materials[index]['density']
                for _, weight, shape in integration(nodes[tet]):
                    forces[tet] += density*1e-9*weight*shape[:,None]*acceleration
        elif kind in ('force','pressure'):
            triangles = [tri for face in selected(load) for tri in face.get('loadTriangles', face['triangles'])]
            areas = [np.cross(nodes[t[1]]-nodes[t[0]],nodes[t[2]]-nodes[t[0]])/2 for t in triangles]
            total_area = sum(np.linalg.norm(a) for a in areas)
            if total_area<=0: raise ValueError('Área carregada inválida.')
            force = vector(load.get('vector'), 'Força (N)') if kind=='force' else None
            pressure = number(load.get('pressure'), 'Pressão (MPa)', -1e9, 1e9) if kind=='pressure' else None
            for tri, area_vector in zip(triangles, areas):
                traction = force*np.linalg.norm(area_vector)/total_area if kind=='force' else -pressure*area_vector
                if len(tri) == 6:
                    forces[tri[3:]] += traction/3
                else:
                    forces[tri] += traction/3
        else:
            raise ValueError('Tipo de carga inválido.')
    if np.linalg.norm(forces) < 1e-12:
        raise ValueError('Adicione pelo menos uma carga não nula.')
    return nodes, fixed, forces, constitutive(young,poisson)


def write_deck(mesh, study, folder, load_factor=1., active=None, interfaces=None, prepared=None):
    nodes, fixed, forces, _ = prepared if prepared is not None else prepare_analysis(mesh, study)
    lines = ['*HEADING', 'Eksteel static linear - mm N MPa', '*NODE, NSET=NALL']
    lines += [f'{i+1}, '+', '.join(f'{v:.12g}' for v in p) for i,p in enumerate(nodes)]
    lines += [f"*ELEMENT, TYPE={mesh['elementType']}, ELSET=EALL"]
    for i,t in enumerate(mesh['tetrahedra']):
        ordered = positive_order(t, nodes)
        lines.append(f'{i+1}, '+', '.join(str(n+1) for n in ordered))
    materials = element_materials(mesh, study)
    groups = {}
    for index, mat in enumerate(materials):
        key = (mat['young'],mat['poisson'])
        groups.setdefault(key, []).append(index+1)
    for group, ((young, poisson), elements) in enumerate(groups.items()):
        lines += [f'*ELSET, ELSET=REGION{group}']
        lines += [', '.join(str(e) for e in elements[i:i+16]) for i in range(0,len(elements),16)]
        lines += [f'*MATERIAL, NAME=MAT{group}', '*ELASTIC', f'{young}, {poisson}', f'*SOLID SECTION, ELSET=REGION{group}, MATERIAL=MAT{group}']
    bonds = interfaces if interfaces is not None else build_bonds(mesh, study, connected_bodies(mesh['tetrahedra']), fixed)
    lines += equation_lines(bonds)
    auxiliary_boundaries=[];auxiliary_loads=[]
    if active is not None:
        springs,auxiliary_boundaries,auxiliary_loads=spring_lines(mesh,[b for b in bonds if b['kind']=='frictionless'],active)
        lines += [f'** Frictionless active-set linearization; load factor {load_factor:.12g}']+springs
    lines += ['*BOUNDARY']+auxiliary_boundaries
    lines += [f'{d//3+1}, {d%3+1}, {d%3+1}' for d in sorted(fixed)]
    lines += ['*STEP', '*STATIC', '*CLOAD']
    lines += auxiliary_loads
    for i, force in enumerate(forces*load_factor):
        lines += [f'{i+1}, {axis+1}, {value:.12g}' for axis,value in enumerate(force) if abs(value)>1e-20]
    lines += ['*NODE PRINT, NSET=NALL', 'U', '*END STEP']
    (folder/'analysis.inp').write_text('\n'.join(lines)+'\n')


def parse_displacements(text, count):
    result=None;active=False
    for line in text.splitlines():
        stripped=line.strip()
        if stripped.lower().startswith('displacements') and 'set' in stripped.lower():
            result=np.full((count,3),np.nan);active=True
            continue
        if not active or not stripped:continue
        fields=stripped.split()
        if len(fields)==4 and fields[0].isdigit():
            index=int(fields[0])-1
            if index<0 or index>=count:raise ValueError('Nó inválido na saída do solver.')
            if np.isfinite(result[index]).any():raise ValueError('Nó repetido na saída do solver.')
            result[index]=[float(v.replace('D','E').replace('d','e')) for v in fields[1:]]
        else:
            active=False
    if result is None or not np.isfinite(result).all():
        raise ValueError('O solver não retornou deslocamentos completos. Verifique apoios e geometria.')
    return result


def recover_results(mesh, study, displacement, history=None):
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
    strain_energy = 0.
    materials = element_materials(mesh, study)
    safety = []
    for index, tet in enumerate(mesh['tetrahedra']):
        material = materials[index]
        d = constitutive(material['young'], material['poisson'])
        stress_sum = np.zeros(6); strain_sum = np.zeros(6); vol = 0.; peak = 0.
        stiffness = np.zeros((3*len(tet), 3*len(tet)))
        for b, weight, _ in integration(nodes[tet]):
            strain = b@displacement[tet].reshape(-1)
            stress = d@strain
            stiffness += b.T@d@b*weight
            internal[tet] += (b.T@stress*weight).reshape(-1,3)
            strain_energy += float(strain@stress)*weight/2
            stress_sum += stress*weight; strain_sum += strain*weight; vol += weight
            peak = max(peak, von_mises(stress))
        uncertainty[tet] += (np.abs(stiffness)@precision[tet].reshape(-1)).reshape(-1,3)
        if peak > 1e-12: safety.append(material['yieldStress']/peak)
        stresses.append((stress_sum/vol).tolist()); strains.append((strain_sum/vol).tolist()); vm.append(peak)
        nodal_vm[tet] += peak*vol; weights[tet] += vol
    residual=internal-forces
    bonds = build_bonds(mesh, study, connected_bodies(mesh['tetrahedra']), fixed)
    # Remove penalty forces before recovering bonded constraint reactions.
    # Otherwise contact forces can be mistaken for support/bond reactions.
    unilateral = [b for b in bonds if b['kind']=='frictionless']
    residual, uncertainty, penalty_forces, penalty_reports = recover_unilateral(unilateral,residual,uncertainty,displacement,precision,mesh['size'])
    residual, uncertainty, bonded_forces, bonded_reports = recover_bonds(bonds,residual,uncertainty,displacement,precision)
    contact_forces = penalty_forces+bonded_forces
    reports_by_id = {r['id']:r for r in penalty_reports+bonded_reports}
    contact_reports = [reports_by_id[b['id']] for b in bonds]
    reactions=np.zeros_like(nodes)
    for dof in fixed: reactions[dof//3,dof%3]=residual[dof//3,dof%3]
    balance=reactions.sum(axis=0)+forces.sum(axis=0)
    free = residual.reshape(-1).copy()
    free[list(fixed)] = 0
    reference=max(float(np.linalg.norm(forces)),1e-9)
    unexplained = np.maximum(np.abs(free)-uncertainty.reshape(-1),0)
    if np.linalg.norm(unexplained)>reference*1e-4 or np.linalg.norm(balance)>max(reference, float(np.linalg.norm(forces.sum(axis=0))))*0.01:
        raise ValueError('A solução não passou na verificação de equilíbrio. Revise a malha e as fixações.')
    origin = nodes.mean(axis=0)
    arms = nodes-origin
    applied_moment = np.cross(arms, forces).sum(axis=0)
    reaction_moment = np.cross(arms, reactions).sum(axis=0)
    moment_error = float(np.linalg.norm(applied_moment+reaction_moment))
    moment_reference = max(float(np.linalg.norm(np.ptp(nodes, axis=0)))*reference, 1e-9)
    if moment_error > moment_reference*0.01:
        raise ValueError('A solução não passou na verificação de equilíbrio de momentos.')
    magnitude=np.linalg.norm(displacement,axis=1)
    return {'nonlinearHistory':history or [], 'contacts':contact_reports, 'nodalContactForces':contact_forces.tolist() if bonds else [], 'displacements':displacement.tolist(), 'displacementMagnitude':magnitude.tolist(), 'elementStress':stresses, 'elementStrain':strains, 'elementVonMises':vm, 'nodalVonMises':(nodal_vm/weights).tolist(), 'reactions':reactions.tolist(), 'summary':{'strainEnergy':strain_energy, 'momentBalanceError':moment_error, 'appliedMoment':applied_moment.tolist(), 'reactionMoment':reaction_moment.tolist(), 'maxDisplacement':float(magnitude.max()), 'maxVonMises':max(vm), 'minSafetyFactor':float(min(safety)) if safety else None, 'reaction':reactions.sum(axis=0).tolist(), 'appliedForce':forces.sum(axis=0).tolist(), 'balanceError':float(np.linalg.norm(balance)), 'freeResidualRelative':float(np.linalg.norm(free)/reference)}, 'solver':'CalculiX', 'elementType':mesh['elementType']}


def run_calculix(folder, count, timeout=180):
    env={**os.environ, 'OMP_NUM_THREADS':'1', 'CCX_NPROC_RESULTS':'1', 'CCX_NPROC_EQUATION_SOLVER':'1'}
    binary=os.environ.get('CCX_BIN','ccx')
    (folder/'analysis.dat').unlink(missing_ok=True)
    with (folder/'solver.log').open('w') as output:
        try:
            completed=subprocess.run([binary,'-i','analysis'],cwd=folder,env=env,stdout=output,stderr=subprocess.STDOUT,timeout=timeout)
        except subprocess.TimeoutExpired as error:
            raise ValueError('Tempo limite de solução excedido.') from error
    log=(folder/'solver.log').read_text(errors='replace')
    if completed.returncode or '*ERROR' in log.upper() or 'Job finished' not in log or not (folder/'analysis.dat').exists():
        raise ValueError('CalculiX não concluiu a análise. Revise material, malha e apoios.')
    return parse_displacements((folder/'analysis.dat').read_text(),count)


def solve(mesh, study, folder):
    prepared=prepare_analysis(mesh,study)
    interfaces=build_bonds(mesh,study,connected_bodies(mesh['tetrahedra']),prepared[1])
    history=None
    unilateral = [b for b in interfaces if b['kind']=='frictionless']
    if unilateral:
        def run_linear(factor, active, remaining):
            write_deck(mesh,study,folder,factor,active,interfaces,prepared)
            return run_calculix(folder,len(mesh['nodes']),remaining)
        displacement,history=solve_incremental(mesh,unilateral,run_linear)
    else:
        write_deck(mesh,study,folder,interfaces=interfaces,prepared=prepared)
        displacement=run_calculix(folder,len(mesh['nodes']))
    return recover_results(mesh,study,displacement,history)

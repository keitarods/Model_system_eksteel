"""Planar, coincident bonded interfaces using explicit CalculiX MPC equations.

A slave surface is interpolated onto a master surface. No node motion, penalty
stiffness, gap closure, sliding or separation is introduced.
"""
import numpy as np


def surface_nodes(face):
    return sorted({n for tri in face['triangles'] for n in tri})


def planar_surface(face, nodes, epsilon):
    triangles = face.get('loadTriangles', face['triangles'])
    points = nodes[np.array([t[:3] for t in triangles])]
    crosses = np.cross(points[:,1]-points[:,0], points[:,2]-points[:,0])
    lengths = np.linalg.norm(crosses, axis=1)
    if np.any(lengths <= 1e-15):
        raise ValueError('Face de contato degenerada.')
    normal = crosses[0]/lengths[0]
    if np.any(crosses@normal/lengths < 1-1e-8) or np.max(np.abs((nodes[surface_nodes(face)]-points[0,0])@normal)) > epsilon:
        raise ValueError('O contato atual exige faces planas. Refine ou prepare uma interface plana.')
    return triangles, points, normal


def covered_surface(master_points, slave_points, normal):
    """Intersect projected facets to detect holes missed by a node-only search."""
    origin=master_points[0,0]
    x=master_points[0,1]-origin;x=x/np.linalg.norm(x);y=np.cross(normal,x)
    basis=np.column_stack((x,y))
    master=(master_points-origin)@basis;slave=(slave_points-origin)@basis
    lower=master.min(axis=1);upper=master.max(axis=1)
    def cross(a,b):return a[0]*b[1]-a[1]*b[0]
    def area(poly):
        if len(poly)<3:return 0.
        return abs(sum(cross(poly[i]-poly[0],poly[i+1]-poly[0]) for i in range(1,len(poly)-1)))/2
    for triangle in slave:
        target=area(triangle);overlap=0.
        candidates=np.flatnonzero(np.all(upper>=triangle.min(axis=0)-1e-10,axis=1)&np.all(lower<=triangle.max(axis=0)+1e-10,axis=1))
        for index in candidates:
            polygon=list(triangle)
            for a,b in zip(master[index],np.roll(master[index],-1,axis=0)):
                output=[]
                for k,p in enumerate(polygon):
                    q=polygon[(k+1)%len(polygon)]
                    dp=cross(b-a,p-a);dq=cross(b-a,q-a)
                    if dp>=0:output.append(p)
                    if (dp>=0)!=(dq>=0):output.append(p+(q-p)*(dp/(dp-dq)))
                polygon=output
                if not polygon:break
            overlap+=area(polygon)
        if abs(overlap-target)>max(target,1e-12)*1e-6:
            raise ValueError('A interface tem cobertura parcial ou furos incompatíveis. Prepare faces com sobreposição integral.')


def build_bonds(mesh, study, bodies, fixed):
    contacts = study.get('contacts', [])
    if not isinstance(contacts, list) or len(contacts)>100:
        raise ValueError('Lista de contatos inválida.')
    if not contacts:
        return []
    nodes = np.asarray(mesh['nodes'])
    faces = {f['id']:f for f in mesh['faces']}
    body_of = {n:i for i,body in enumerate(bodies) for n in body}
    # Geometry tolerance only handles numerical noise, never a physical gap.
    epsilon = min(max(float(np.linalg.norm(np.ptp(nodes, axis=0))),1)*1e-8,1e-5)
    bonds=[]; used_slaves=set(); ids=set(); work=0
    for contact in contacts:
        if not isinstance(contact,dict) or contact.get('kind') not in ('bonded','frictionless') or not isinstance(contact.get('id'),str) or not contact['id'] or contact['id'] in ids:
            raise ValueError('Contato inválido ou repetido.')
        ids.add(contact['id'])
        kind=contact['kind']
        search=epsilon;stiffness=None
        if kind=='frictionless':
            search=contact.get('searchDistance');stiffness=contact.get('normalStiffness')
            if isinstance(search,bool) or not isinstance(search,(int,float)) or not np.isfinite(search) or not 0<=search<=10:
                raise ValueError('Distância de busca do contato deve estar entre 0 e 10 mm.')
            if isinstance(stiffness,bool) or not isinstance(stiffness,(int,float)) or not np.isfinite(stiffness) or not 1<=stiffness<=1e9:
                raise ValueError('Rigidez normal deve estar entre 1 e 1e9 N/mm³.')
        master_id,slave_id=contact.get('masterFaceId'),contact.get('slaveFaceId')
        if type(master_id) is not int or type(slave_id) is not int or master_id not in faces or slave_id not in faces or master_id==slave_id:
            raise ValueError('Selecione duas faces válidas para o contato.')
        master,slave=faces[master_id],faces[slave_id]
        master_nodes,slave_nodes=surface_nodes(master),surface_nodes(slave)
        master_bodies={body_of[n] for n in master_nodes}; slave_bodies={body_of[n] for n in slave_nodes}
        if len(master_bodies)!=1 or len(slave_bodies)!=1 or master_bodies==slave_bodies:
            raise ValueError('O contato exige corpos independentes. Desative a união geométrica e gere novamente a malha.')
        if used_slaves.intersection(slave_nodes):
            raise ValueError('Um nó não pode pertencer a duas faces dependentes. Inverta ou reorganize os pares.')
        if kind=='bonded' and any(3*n+axis in fixed for n in slave_nodes for axis in range(3)):
            raise ValueError('Há fixação em nós da face dependente. Inverta as faces do contato ou altere o apoio.')
        triangles,points,normal=planar_surface(master,nodes,epsilon)
        _,slave_points,slave_normal=planar_surface(slave,nodes,epsilon)
        if np.dot(normal,slave_normal)>-1+1e-8:
            raise ValueError('As faces do contato precisam ter normais opostas.')
        work += len(slave_nodes)*len(triangles)
        if work>30_000_000:
            raise ValueError('Contato acima do limite de busca. Use uma malha mestre mais grossa ou divida as faces.')
        distances=(slave_points-points[0,0])@normal
        if (kind=='bonded' and np.max(np.abs(distances))>epsilon) or (kind=='frictionless' and (distances.min() < -epsilon or distances.max()>search+epsilon)):
            raise ValueError('A face dependente não está integralmente sobre a face mestre: existe folga ou penetração inicial.')
        covered_surface(points,slave_points,normal)
        edge1,edge2=points[:,1]-points[:,0],points[:,2]-points[:,0]
        d00=np.einsum('ij,ij->i',edge1,edge1);d01=np.einsum('ij,ij->i',edge1,edge2);d11=np.einsum('ij,ij->i',edge2,edge2)
        denominator=d00*d11-d01*d01
        mappings=[];max_gap=0.;initial_gaps=[]
        for node in slave_nodes:
            delta=nodes[node]-points[:,0]
            gap=delta@normal
            d20=np.einsum('ij,ij->i',delta,edge1);d21=np.einsum('ij,ij->i',delta,edge2)
            v=(d11*d20-d01*d21)/denominator;w=(d00*d21-d01*d20)/denominator
            bary=np.column_stack((1-v-w,v,w))
            candidates=np.flatnonzero(((np.abs(gap)<=epsilon) if kind=='bonded' else ((gap>=-epsilon)&(gap<=search+epsilon)))&np.all(bary>=-1e-9,axis=1)&np.all(bary<=1+1e-9,axis=1))
            if not len(candidates):
                raise ValueError('A face dependente não está integralmente sobre a face mestre. Não são permitidas folgas ou sobreposição parcial; inverta as faces ou prepare a geometria.')
            index=int(candidates[np.argmin(np.abs(gap[candidates]))]);weights=bary[index];masters=triangles[index]
            if len(masters)==6:
                a,b,c=weights
                weights=np.array([a*(2*a-1),b*(2*b-1),c*(2*c-1),4*a*b,4*b*c,4*c*a])
            mappings.append((node,list(masters),weights))
            initial_gaps.append(max(float(gap[index]),0.))
            max_gap=max(max_gap,float(abs(gap[index])))
        used_slaves.update(slave_nodes)
        areas={n:0. for n in slave_nodes}
        for tri in slave['triangles']:
            a,b,c=nodes[tri];area=float(np.linalg.norm(np.cross(b-a,c-a)))/2
            for n in tri:areas[n]+=area/3
        bonds.append({'id':contact['id'],'kind':kind,'normal':normal,'gaps':initial_gaps,
                      'areas':[areas[n] for n in slave_nodes],'normalStiffness':stiffness,
                      'masterBody':next(iter(master_bodies)),'slaveBody':next(iter(slave_bodies)),
                      'mappings':mappings,'maxInitialGap':max_gap})
    # Keep the transformation acyclic and unambiguous, including shared edges.
    if any(used_slaves.intersection(master for _,masters,_ in bond['mappings'] for master in masters) for bond in bonds):
        raise ValueError('Um nó dependente também é mestre de outro contato. Inverta ou reorganize os pares.')
    return bonds


def bonded_groups(bodies, bonds):
    parents=list(range(len(bodies)))
    def root(i):
        while parents[i]!=i:
            parents[i]=parents[parents[i]];i=parents[i]
        return i
    for bond in bonds:
        if bond['kind']!='bonded':continue
        parents[root(bond['slaveBody'])]=root(bond['masterBody'])
    groups={}
    for i,body in enumerate(bodies):groups.setdefault(root(i),[]).extend(body)
    return list(groups.values())


def equation_lines(bonds):
    lines=[]
    for bond in bonds:
        if bond['kind']!='bonded':continue
        for slave,masters,weights in bond['mappings']:
            for axis in range(1,4):
                terms=[f'{slave+1}, {axis}, 1']+[f'{master+1}, {axis}, {-weight:.16g}' for master,weight in zip(masters,weights) if abs(weight)>1e-14]
                lines.extend(['*EQUATION',str(len(terms))])
                lines.extend(', '.join(terms[i:i+4]) for i in range(0,len(terms),4))
    return lines


def recover_bonds(bonds, residual, uncertainty, displacement, precision):
    reduced=residual.copy(); bound=uncertainty.copy(); contact_forces=np.zeros_like(residual); reports=[]
    for bond in bonds:
        if bond['kind']!='bonded':continue
        transmitted=np.zeros(3);max_jump=0.
        for slave,masters,weights in bond['mappings']:
            jump=displacement[slave]-weights@displacement[masters]
            permitted=precision[slave]+np.abs(weights)@precision[masters]+1e-10
            if np.any(np.abs(jump)>permitted):
                raise ValueError('O solver não respeitou a compatibilidade do contato aderido.')
            force=residual[slave].copy();transmitted+=force
            contact_forces[slave]+=force;contact_forces[masters]-=weights[:,None]*force
            reduced[masters]+=weights[:,None]*force;reduced[slave]=0
            bound[masters]+=np.abs(weights)[:,None]*uncertainty[slave];bound[slave]=0
            max_jump=max(max_jump,float(np.linalg.norm(jump)))
        reports.append({'id':bond['id'],'kind':'bonded','bondedNodes':len(bond['mappings']),'maxInitialGap':bond['maxInitialGap'],
                        'maxRelativeDisplacement':max_jump,'slaveForce':transmitted.tolist(),'masterForce':(-transmitted).tolist()})
    return reduced,bound,contact_forces,reports

"""Straight-sided C3D4/C3D10 interpolation in CalculiX node order.

C3D10 uses four integration points. Mid-edge nodes lie on the linear mesh;
curved CAD surfaces therefore still require geometric mesh refinement.
"""
import numpy as np

EDGES = ((0, 1), (1, 2), (2, 0), (0, 3), (1, 3), (2, 3))


def elevate_mesh(nodes, tetrahedra, faces):
    nodes = nodes.tolist()
    edges = {}
    def midpoint(a, b):
        key = tuple(sorted((a, b)))
        if key not in edges:
            edges[key] = len(nodes)
            nodes.append(((np.array(nodes[a])+nodes[b])/2).tolist())
        return edges[key]
    quadratic = [t + [midpoint(t[a], t[b]) for a, b in EDGES] for t in tetrahedra]
    for face in faces:
        triangles, owners, surfaces = [], [], []
        for tri, owner in zip(face['triangles'], face['elements']):
            a, b, c = tri
            ab, bc, ca = midpoint(a, b), midpoint(b, c), midpoint(c, a)
            surfaces.append([a, b, c, ab, bc, ca])
            triangles.extend([[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]])
            owners.extend([owner]*4)
        face.update(triangles=triangles, elements=owners, loadTriangles=surfaces)
    return np.array(nodes), quadratic


def integration(points):
    coordinates = np.column_stack((np.ones(4), points[:4]))
    volume = abs(np.linalg.det(coordinates))/6
    if volume < 1e-15:
        raise ValueError('Elemento degenerado.')
    gradients = np.linalg.inv(coordinates)[1:, :].T
    if len(points) == 4:
        samples = [(np.full(4, .25), 1.)]
    elif len(points) == 10:
        expected = np.array([(points[a]+points[b])/2 for a, b in EDGES])
        if not np.allclose(points[4:], expected, rtol=0, atol=max(np.ptp(points, axis=0).max(), 1)*1e-9):
            raise ValueError('C3D10 requer nós intermediários no centro das arestas.')
        a, b = (5+3*np.sqrt(5))/20, (5-np.sqrt(5))/20
        samples = [(np.array([a if i == j else b for i in range(4)]), .25) for j in range(4)]
    else:
        raise ValueError('Elemento não suportado.')
    for barycentric, weight in samples:
        if len(points) == 4:
            shape, grad = barycentric, gradients
        else:
            shape = np.r_[barycentric*(2*barycentric-1), [4*barycentric[a]*barycentric[b] for a, b in EDGES]]
            grad = np.vstack(((4*barycentric-1)[:, None]*gradients,
                [4*(barycentric[a]*gradients[b]+barycentric[b]*gradients[a]) for a, b in EDGES]))
        matrix = np.zeros((6, 3*len(points)))
        for i, (x, y, z) in enumerate(grad):
            matrix[:, 3*i:3*i+3] = [[x,0,0],[0,y,0],[0,0,z],[y,x,0],[0,z,y],[z,0,x]]
        yield matrix, volume*weight, shape


def positive_order(tet, nodes):
    if np.linalg.det(np.column_stack((np.ones(4), nodes[tet[:4]]))) >= 0:
        return tet
    permutation = [0, 2, 1, 3]
    if len(tet) == 10:
        edge_lookup = {tuple(sorted(edge)): i+4 for i, edge in enumerate(EDGES)}
        permutation += [edge_lookup[tuple(sorted((permutation[a], permutation[b])))] for a, b in EDGES]
    return [tet[i] for i in permutation]


def von_mises(stress):
    x, y, z, xy, yz, zx = stress
    return float(np.sqrt(((x-y)**2+(y-z)**2+(z-x)**2)/2+3*(xy*xy+yz*yz+zx*zx)))

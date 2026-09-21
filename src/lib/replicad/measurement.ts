import { DistanceTool, getOC, makeVertex, type Solid } from 'replicad';

type Point = [number, number, number];
export type MeasurementSelection =
  | { kind: 'face'; faceId: number }
  | { kind: 'edge'; edgeId: number }
  | { kind: 'vertex'; point: Point }
  | { kind: 'circle'; edgeId: number; point: Point; radius: number };

/** Snap to an actual endpoint on the picked face, never to its interior. */
export function closestEdgeEndpoint(solid: Solid, faceId: number, hit: Point): MeasurementSelection {
  const faces = solid.faces;
  try {
    const face = faces.find(f => f.hashCode === faceId);
    if (!face) throw new Error('Face não encontrada; selecione novamente.');
    const edges = face.edges;
    try {
      let point: Point | undefined;
      let best = Infinity;
      for (const edge of edges) {
        if (edge.isClosed) continue; // A closed circular seam is not a real endpoint.
        for (const t of [0, 1]) {
          const v = edge.pointAt(t);
          const p: Point = [v.x, v.y, v.z];
          v.delete();
          const distance = Math.hypot(...p.map((x, i) => x - hit[i]));
          if (distance < best) { best = distance; point = p; }
        }
      }
      if (!point) throw new Error('Esta face não possui extremidades de arestas. Selecione a face sem Shift.');
      return { kind: 'vertex', point };
    } finally { edges.forEach(e => e.delete()); }
  } finally { faces.forEach(f => f.delete()); }
}

/** Select the closest actual edge of the picked face, including curved edges. */
export function closestFaceEdge(solid: Solid, faceId: number, hit: Point): MeasurementSelection {
  const faces = solid.faces;
  const vertex = makeVertex(hit);
  const tool = new DistanceTool();
  try {
    const face = faces.find(f => f.hashCode === faceId);
    if (!face) throw new Error('Face não encontrada; selecione novamente.');
    const edges = face.edges;
    try {
      let edgeId: number | undefined;
      let best = Infinity;
      for (const edge of edges) {
        const distance = tool.distanceBetween(vertex, edge);
        if (Number.isFinite(distance) && distance < best) {
          best = distance;
          edgeId = edge.hashCode;
        }
      }
      if (edgeId === undefined) throw new Error('Nenhuma aresta disponível nesta face.');
      return { kind: 'edge', edgeId };
    } finally { edges.forEach(e => e.delete()); }
  } finally { tool.delete(); vertex.delete(); faces.forEach(f => f.delete()); }
}

/** Circular rim reference: exact center and radius, independent of click location. */
export function closestCircleCenter(solid: Solid, faceId: number, hit: Point): MeasurementSelection {
  const faces = solid.faces;
  const vertex = makeVertex(hit);
  const tool = new DistanceTool();
  try {
    const face = faces.find(f => f.hashCode === faceId);
    if (!face) throw new Error('Face não encontrada. Selecione novamente.');
    const adjacent = face.edges;
    const adjacentIds = new Set(adjacent.map(e => e.hashCode));
    adjacent.forEach(e => e.delete());
    const edges = solid.edges;
    try {
      let result: MeasurementSelection | undefined;
      let best = Infinity;
      for (const edge of edges) {
        if (edge.geomType !== 'CIRCLE') continue;
        const distance = tool.distanceBetween(vertex, edge);
        if (distance >= best) continue;
        const adapter = new (getOC().BRepAdaptor_Curve_2)(edge.wrapped);
        try {
          const circle = adapter.Circle();
          try {
            // Permit a nearby rim on an adjacent face (e.g. a chamfer), but
            // never silently choose a remote circle elsewhere in the model.
            if (!adjacentIds.has(edge.hashCode) && distance > Math.max(0.1, circle.Radius() * 0.15)) continue;
            const center = circle.Location();
            try {
              result = { kind: 'circle', edgeId: edge.hashCode,
                point: [center.X(), center.Y(), center.Z()], radius: circle.Radius() };
              best = distance;
            } finally { center.delete(); }
          } finally { circle.delete(); }
        } finally { adapter.delete(); }
      }
      if (!result) throw new Error('Selecione uma face junto à borda circular do furo. Nenhuma aresta circular encontrada.');
      return result;
    } finally { edges.forEach(e => e.delete()); }
  } finally { tool.delete(); vertex.delete(); faces.forEach(f => f.delete()); }
}

/** Exact BRep distance; XYZ describes one minimum-distance pair in model coordinates. */
export function measureSelections(solid: Solid, a: MeasurementSelection, b: MeasurementSelection) {
  if (a.kind === 'face' && b.kind === 'face' && a.faceId === b.faceId) {
    throw new Error('Selecione duas faces diferentes.');
  }
  if (a.kind === 'edge' && b.kind === 'edge' && a.edgeId === b.edgeId) {
    throw new Error('Selecione duas arestas diferentes.');
  }
  const faces = solid.faces;
  const edges = a.kind === 'edge' || b.kind === 'edge' ? solid.edges : [];
  const vertices: ReturnType<typeof makeVertex>[] = [];
  const tool = new DistanceTool();
  try {
    const resolve = (s: MeasurementSelection) => {
      if (s.kind === 'vertex' || s.kind === 'circle') {
        const v = makeVertex(s.point);
        vertices.push(v);
        return v;
      }
      if (s.kind === 'edge') {
        const edge = edges.find(e => e.hashCode === s.edgeId);
        if (!edge) throw new Error('A geometria mudou. Selecione novamente as referências.');
        return edge;
      }
      const face = faces.find(f => f.hashCode === s.faceId);
      if (!face) throw new Error('A geometria mudou. Selecione novamente as referências.');
      return face;
    };
    const distance = tool.distanceBetween(resolve(a), resolve(b));
    if (!Number.isFinite(distance) || !tool.wrapped.IsDone() || tool.wrapped.NbSolution() < 1) {
      throw new Error('Não foi possível calcular a distância.');
    }
    // A curved surface has no single plane angle: do not use a click-dependent normal.
    let angleDegrees: number | null = null;
    if (a.kind === 'face' && b.kind === 'face') {
      const firstFace = faces.find(f => f.hashCode === a.faceId)!;
      const secondFace = faces.find(f => f.hashCode === b.faceId)!;
      if (firstFace.geomType === 'PLANE' && secondFace.geomType === 'PLANE') {
        const n1 = firstFace.normalAt();
        const n2 = secondFace.normalAt();
        try {
          const cosine = (n1.x * n2.x + n1.y * n2.y + n1.z * n2.z)
            / (Math.hypot(n1.x, n1.y, n1.z) * Math.hypot(n2.x, n2.y, n2.z));
          // Unoriented planes: smaller angle plus its supplement in the UI.
          angleDegrees = Math.acos(Math.min(1, Math.max(0, Math.abs(cosine)))) * 180 / Math.PI;
        } finally { n1.delete(); n2.delete(); }
      }
    }
    const p = tool.wrapped.PointOnShape1(1);
    const q = tool.wrapped.PointOnShape2(1);
    try {
      const first: Point = [p.X(), p.Y(), p.Z()];
      const second: Point = [q.X(), q.Y(), q.Z()];
      return {
        distance,
        angleDegrees,
        delta: second.map((v, i) => v - first[i]) as Point,
        points: [first, second],
      };
    } finally { p.delete(); q.delete(); }
  } finally {
    tool.delete();
    vertices.forEach(v => v.delete());
    edges.forEach(e => e.delete());
    faces.forEach(f => f.delete());
  }
}

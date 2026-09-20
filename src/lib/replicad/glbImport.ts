import { LoadingManager, Matrix4, Mesh, Vector3, type Object3D } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export type MeshBody = { name: string; path: string; stl: Blob };
const MAX_TRIANGLES = 100_000;
const isMesh = (object: Object3D): object is Mesh => !!(object as Mesh).isMesh;

/** Read geometry only. Embedded images are intentionally not decoded for CAD. */
function geometryGLB(data: ArrayBuffer): ArrayBuffer {
  if (data.byteLength < 20) throw new Error("GLB incompleto.");
  const view = new DataView(data);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== data.byteLength) {
    throw new Error("Escolha um arquivo GLB versão 2 válido.");
  }
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a || jsonLength % 4 || 20 + jsonLength > data.byteLength) throw new Error("Cabeçalho GLB inválido.");
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(data, 20, jsonLength)));
  if (json.asset?.version !== "2.0") throw new Error("GLB versão 2 é necessário.");
  if ((json.buffers ?? []).some((buffer: { uri?: string }) => buffer.uri)) throw new Error("GLB precisa conter a geometria incorporada, sem buffers externos.");
  if ((json.extensionsRequired ?? []).length) throw new Error("Exporte GLB sem extensões obrigatórias/compressão para converter em CAD.");
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      if ((primitive.mode ?? 4) !== 4 || primitive.targets || primitive.extensions?.KHR_draco_mesh_compression) {
        throw new Error("Importe malhas triangulares estáticas, sem morph targets ou compressão Draco.");
      }
      delete primitive.material;
      const count = json.accessors?.[primitive.indices ?? primitive.attributes?.POSITION]?.count;
      if (!Number.isInteger(count) || count < 3 || count > MAX_TRIANGLES * 3) throw new Error("Malha excede o limite de triângulos ou possui accessor inválido.");
    }
  }
  if ((json.nodes ?? []).some((node: { skin?: number }) => node.skin !== undefined)) throw new Error("Malhas com esqueleto não podem ser convertidas em sólidos CAD.");
  // Materials, images and animations are not needed to build the static BREP.
  delete json.images; delete json.textures; delete json.materials; delete json.animations;
  const encoded = new TextEncoder().encode(JSON.stringify(json));
  const padded = Math.ceil(encoded.length / 4) * 4;
  const remainder = new Uint8Array(data, 20 + jsonLength);
  const output = new ArrayBuffer(20 + padded + remainder.length);
  const header = new DataView(output);
  header.setUint32(0, 0x46546c67, true); header.setUint32(4, 2, true); header.setUint32(8, output.byteLength, true);
  header.setUint32(12, padded, true); header.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(output, 20, padded).fill(32);
  new Uint8Array(output, 20, encoded.length).set(encoded);
  new Uint8Array(output, 20 + padded).set(remainder);
  return output;
}

/** Bake node transforms, convert glTF metres/Y-up to application mm/Z-up. */
export function meshSTL(mesh: Mesh, scale: number): Blob {
  const positions = mesh.geometry.getAttribute("position");
  const index = mesh.geometry.getIndex();
  const count = index ? index.count : positions?.count ?? 0;
  if (!positions || count < 3 || count % 3 || count / 3 > MAX_TRIANGLES) throw new Error("Malha inválida ou acima do limite de 100 mil triângulos.");
  const transform = new Matrix4().makeRotationX(Math.PI / 2).multiply(new Matrix4().makeScale(scale, scale, scale)).multiply(mesh.matrixWorld);
  if (Math.abs(transform.determinant()) < 1e-15) throw new Error("Malha com transformação degenerada.");
  const reverse = transform.determinant() < 0;
  const buffer = new ArrayBuffer(84 + count / 3 * 50);
  const view = new DataView(buffer);
  view.setUint32(80, count / 3, true);
  const vertices = [new Vector3(), new Vector3(), new Vector3()];
  const normal = new Vector3(), edge = new Vector3();
  for (let i = 0; i < count; i += 3) {
    for (let corner = 0; corner < 3; corner++) {
      const ordinal = i + (reverse && corner > 0 ? 3 - corner : corner);
      const vertex = index ? index.getX(ordinal) : ordinal;
      if (!Number.isInteger(vertex) || vertex < 0 || vertex >= positions.count) throw new Error("Índice de triângulo inválido.");
      vertices[corner].fromBufferAttribute(positions, vertex).applyMatrix4(transform);
      if (!vertices[corner].toArray().every(Number.isFinite)) throw new Error("Coordenadas não finitas no GLB.");
    }
    normal.subVectors(vertices[1], vertices[0]).cross(edge.subVectors(vertices[2], vertices[0]));
    if (normal.lengthSq() < 1e-20) throw new Error("GLB contém triângulos degenerados; repare a malha antes de importar.");
    normal.normalize();
    let offset = 84 + i / 3 * 50;
    for (const value of [...normal.toArray(), ...vertices.flatMap(v => v.toArray())]) {
      if (!Number.isFinite(Math.fround(value))) throw new Error("Coordenadas fora do intervalo suportado.");
      view.setFloat32(offset, value, true); offset += 4;
    }
  }
  return new Blob([buffer]);
}

export async function readGLBBodies(file: Blob, scale = 1000): Promise<MeshBody[]> {
  if (!Number.isFinite(scale) || scale <= 0) throw new Error("Escala GLB deve ser positiva.");
  const manager = new LoadingManager();
  manager.setURLModifier(() => { throw new Error("Recursos externos não são aceitos na importação GLB."); });
  const gltf = await new GLTFLoader(manager).parseAsync(geometryGLB(await file.arrayBuffer()), "");
  const bodies: MeshBody[] = [];
  const groups = new Map<Object3D, { name: string; path: string; chunks: Blob[] }>();
  let triangles = 0;
  try {
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse(object => {
      if (!isMesh(object)) return;
      if ((object as Mesh & { isInstancedMesh?: boolean }).isInstancedMesh) throw new Error("Exporte instâncias como nós separados antes de importar.");
      triangles += (object.geometry.index?.count ?? object.geometry.getAttribute("position")?.count ?? 0) / 3;
      if (triangles > MAX_TRIANGLES) throw new Error("GLB limitado a 100 mil triângulos por importação.");
      // GLTFLoader splits a node with multiple material primitives into meshes.
      // Reassemble that node before solid validation, otherwise each patch is open.
      let owner: Object3D = object;
      for (let node: Object3D | null = object; node && node !== gltf.scene; node = node.parent) {
        if (gltf.parser.associations.get(node)?.nodes !== undefined) { owner = node; break; }
      }
      const path: string[] = [];
      for (let node = owner.parent; node && node !== gltf.scene; node = node.parent) path.unshift(node.name || "Grupo");
      const name = owner.name || `Corpo ${groups.size + 1}`;
      path.push(name);
      let group = groups.get(owner);
      if (!group) { group = { name, path: path.join(" / "), chunks: [] }; groups.set(owner, group); }
      if (groups.size > 200) throw new Error("GLB limitado a 200 malhas por importação.");
      group.chunks.push(meshSTL(object, scale));
    });
    for (const group of groups.values()) {
      const chunks = await Promise.all(group.chunks.map(blob => blob.arrayBuffer()));
      const header = new ArrayBuffer(84);
      new DataView(header).setUint32(80, chunks.reduce((count, chunk) => count + new DataView(chunk).getUint32(80, true), 0), true);
      bodies.push({ name: group.name, path: group.path, stl: new Blob([header, ...chunks.map(chunk => chunk.slice(84))]) });
    }
    if (!bodies.length) throw new Error("GLB não contém malhas na cena principal.");
    return bodies;
  } finally {
    for (const scene of gltf.scenes) scene.traverse(object => {
      if (isMesh(object)) {
        object.geometry.dispose();
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
      }
    });
  }
}

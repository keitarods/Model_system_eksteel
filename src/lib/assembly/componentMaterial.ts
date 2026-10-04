// Material de componente escolhido na Montagem, ao estilo Inventor: o material
// pertence à PEÇA, então a escolha grava no arquivo .eks3d vinculado (ou na
// cópia incorporada) e vale para todas as ocorrências dessa peça. A aparência
// por ocorrência é outra coisa — fica em ComponentInstance.appearanceOverride,
// só na montagem.
import type { ComponentInstance } from "./types";
import type { PartProperties } from "@/lib/project/partProperties";
import { parseProject, serializeProject } from "@/lib/project/nativeFormat";
import { ensureReadPermission, loadLinkedFileHandle } from "@/lib/project/linkedFiles";
import { writeToFileHandle } from "@/lib/project/folder";

/** Conteúdo da peça com novas propriedades, preservando features e folhas de desenho. */
export function withPartProperties(partJson: string, properties: PartProperties): string {
  const part = parseProject(partJson);
  return serializeProject(part.features, part.drawingSheets, properties,part.simulations);
}

/**
 * Ocorrências que usam a mesma peça que `target`: o mesmo arquivo vinculado
 * (mesmo handle) ou uma cópia incorporada idêntica.
 */
export async function sameSourceInstanceIds(instances: ComponentInstance[], target: ComponentInstance): Promise<string[]> {
  if (target.embeddedPart !== undefined) {
    return instances.filter((i) => i.embeddedPart === target.embeddedPart).map((i) => i.id);
  }
  const handle = await loadLinkedFileHandle(target.linkKey);
  if (!handle) return [target.id];
  const ids: string[] = [];
  for (const instance of instances) {
    if (instance.embeddedPart !== undefined) continue;
    if (instance.linkKey === target.linkKey) { ids.push(instance.id); continue; }
    const other = await loadLinkedFileHandle(instance.linkKey);
    if (other && (await other.isSameEntry(handle))) ids.push(instance.id);
  }
  return ids;
}

/**
 * Grava as propriedades (material) na peça do componente. Devolve as
 * alterações de instância necessárias: para cópias incorporadas, o novo
 * conteúdo de cada ocorrência idêntica; para arquivos vinculados, nada (o
 * arquivo foi gravado e basta reler os vínculos).
 */
export async function savePartProperties(
  instances: ComponentInstance[],
  target: ComponentInstance,
  properties: PartProperties
): Promise<Record<string, Partial<ComponentInstance>>> {
  if (target.embeddedPart !== undefined) {
    const embeddedPart = withPartProperties(target.embeddedPart, properties);
    const ids = await sameSourceInstanceIds(instances, target);
    return Object.fromEntries(ids.map((id) => [id, { embeddedPart }]));
  }
  const handle = await loadLinkedFileHandle(target.linkKey);
  if (!handle) throw new Error(`"${target.label}" não está vinculada — religue o arquivo da peça antes de alterar o material.`);
  if (!(await ensureReadPermission(handle))) throw new Error(`Permissão de leitura negada para "${handle.name}". O material não foi alterado.`);
  const current = await (await handle.getFile()).text();
  // writeToFileHandle pede a permissão de escrita e falha antes de gravar se for negada.
  await writeToFileHandle(handle, withPartProperties(current, properties));
  return {};
}

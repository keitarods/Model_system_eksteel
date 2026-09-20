import type { ComponentInstance, AssemblyConstraint } from '@/lib/assembly/types';
import type { DrawingSheet } from '@/lib/drawing/types';
import { parseProject } from './nativeFormat';
import { serializeAssembly } from './assemblyFormat';
/** Embed once per instance for native-format compatibility, preserving all native part data. */
export async function portableAssembly(instances: ComponentInstance[], constraints: AssemblyConstraint[], sheets: DrawingSheet[], readPart: (instance: ComponentInstance)=>Promise<string>):Promise<string> {
  const parts=new Map<string,string>();const portable:ComponentInstance[]=[];
  for(const instance of instances) {
    let json=instance.embeddedPart ?? parts.get(instance.linkKey);
    if(!json) json=await readPart(instance);
    parseProject(json);parts.set(instance.linkKey,json);
    portable.push({...instance,embeddedPart:json});
  }
  return serializeAssembly(portable,constraints,sheets);
}

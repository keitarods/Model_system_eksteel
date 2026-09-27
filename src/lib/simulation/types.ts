import {DEFAULT_SIMULATION_MATERIAL} from '@/lib/materials/defaults';
export type Vec3 = [number, number, number];
export type FeaMesh = {
  geometryMode?: "part" | "assemblyBonded";
  bodyCount?: number;
  nodes: Vec3[]; tetrahedra: [number, number, number, number][];
  faces: {id: number; triangles: [number,number,number][]; elements: number[]; area: number; center: Vec3}[];
  quality: {minimum:number;mean:number}; volume:number; size:number;
  refinements:{faceId:number;size:number}[]; elementType:'C3D4';
};
export type Material = {name:string;young:number;poisson:number;density:number;yieldStress:number};
export type Support = {id:string;faceIds:number[];axes:[boolean,boolean,boolean]};
export type Load = {id:string;kind:'force'|'pressure'|'gravity';faceIds:number[];vector:Vec3;pressure:number};
export type FeaResults = {
  displacements:Vec3[];displacementMagnitude:number[];nodalVonMises:number[];
  elementStress:number[][];elementStrain:number[][];elementVonMises:number[];reactions:Vec3[];
  summary:{maxDisplacement:number;maxVonMises:number;minSafetyFactor:number|null;reaction:Vec3;appliedForce:Vec3;balanceError:number;freeResidualRelative:number};
  solver:string;elementType:'C3D4';
};
export type Study = {
  geometryMode?: "part" | "assemblyBonded";
  components?: {id:string;label:string}[];
  name:string;sourceName:string;step:string;material:Material;size:number;
  refinements:{faceId:number;size:number}[];supports:Support[];loads:Load[];
  mesh:FeaMesh|null;results:FeaResults|null;
};
/** Material de um estudo novo: o "Steel" padrão do Inventor (Aço). As predefinições vêm da biblioteca padrão no banco. */
export const DEFAULT_MATERIAL:Material = {...DEFAULT_SIMULATION_MATERIAL};
export function emptyStudy():Study {return {name:'Estudo estático 1',sourceName:'',step:'',material:{...DEFAULT_MATERIAL},size:10,refinements:[],supports:[],loads:[],mesh:null,results:null};}

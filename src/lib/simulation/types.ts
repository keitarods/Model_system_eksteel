import {DEFAULT_SIMULATION_MATERIAL} from '@/lib/materials/defaults';
export type ElementType = 'C3D4'|'C3D10';
export type ConvergenceRun = {size:number;nodes:number;elements:number;displacement:number;stress:number;energy:number;displacementChange:number|null;stressChange:number|null;energyChange:number|null};
export type Vec3 = [number, number, number];
export type GeometryPreparation = {heal:boolean;removeSmall:boolean;closeGaps:boolean;unite:boolean;tolerance:number};
export type MeshControls = {minimumSize:number;curvature:number;qualityTarget:number};
export type FeaMesh = {
  regions?:{id:number;elements:number[];volume:number;center:Vec3}[];
  preparationReport?: {originalBodies:number;preparedBodies:number;originalVolume:number;preparedVolume:number;volumeChangePercent:number;tolerance:number};
  geometryMode?: "part" | "assemblyBonded";
  bodyCount?: number;
  nodes: Vec3[]; tetrahedra: number[][];
  faces: {id: number; bodyId?:number; normal?:Vec3; triangles: [number,number,number][]; loadTriangles?: [number,number,number,number,number,number][]; elements: number[]; area: number; center: Vec3}[];
  quality: {minimum:number;mean:number;p05?:number;belowTarget?:number;target?:number}; volume:number; size:number;
  refinements:{faceId:number;size:number}[]; elementType:ElementType;
};
export type BondedContact = {id:string;kind:'bonded';masterFaceId:number;slaveFaceId:number};
export type FrictionlessContact = {id:string;kind:'frictionless';masterFaceId:number;slaveFaceId:number;normalStiffness:number;searchDistance:number};
export type Contact = BondedContact|FrictionlessContact;
export type ContactResult = {id:string;kind?:'bonded'|'frictionless';contactPoints?:number;activePoints?:number;maxOpening?:number;maxPenetration?:number;maxPressure?:number;contactEnergy?:number;maxTangentialSlip?:number;bondedNodes:number;maxInitialGap:number;maxRelativeDisplacement:number;slaveForce:Vec3;masterForce:Vec3};
export type Material = {name:string;young:number;poisson:number;density:number;yieldStress:number};
export type Support = {id:string;faceIds:number[];axes:[boolean,boolean,boolean]};
export type Load = {id:string;kind:'force'|'pressure'|'gravity';faceIds:number[];vector:Vec3;pressure:number;direction?:'vector'|'normal';magnitude?:number;inverted?:boolean};
export type FeaResults = {
  nonlinearHistory?:{loadFactor:number;iterations:number;activePoints:number}[];
  contacts?:ContactResult[];nodalContactForces?:Vec3[];
  displacements:Vec3[];displacementMagnitude:number[];nodalVonMises:number[];
  elementStress:number[][];elementStrain:number[][];elementVonMises:number[];reactions:Vec3[];
  summary:{strainEnergy?:number;momentBalanceError?:number;appliedMoment?:Vec3;reactionMoment?:Vec3;maxDisplacement:number;maxVonMises:number;minSafetyFactor:number|null;reaction:Vec3;appliedForce:Vec3;balanceError:number;freeResidualRelative:number};
  solver:string;elementType:ElementType;
};
export type Study = {
  contacts?:Contact[];
  materialMode?:'uniform'|'regions';
  regionMaterials?:Record<string,Material>;
  elementType?:ElementType;
  convergence?:{tolerance:number;runs:ConvergenceRun[]};
  preparation?:GeometryPreparation;
  meshControls?:MeshControls;
  geometryMode?: "part" | "assemblyBonded";
  components?: {id:string;label:string}[];
  name:string;sourceName:string;step:string;material:Material;size:number;
  refinements:{faceId:number;size:number}[];supports:Support[];loads:Load[];
  mesh:FeaMesh|null;results:FeaResults|null;
};
/** Material de um estudo novo: o "Steel" padrão do Inventor (Aço). As predefinições vêm da biblioteca padrão no banco. */
export const DEFAULT_MATERIAL:Material = {...DEFAULT_SIMULATION_MATERIAL};
export function emptyStudy():Study {return {elementType:'C3D10',name:'Estudo estático 1',sourceName:'',step:'',material:{...DEFAULT_MATERIAL},size:10,refinements:[],supports:[],loads:[],mesh:null,results:null};}

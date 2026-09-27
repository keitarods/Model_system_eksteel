import { create } from 'zustand';
import { emptyStudy, type Study } from './types';
/** Independent document: editing CAD does not silently mutate a completed study. */
export const useSimulationStore=create<{study:Study;setStudy:(study:Study)=>void}>(set=>({study:emptyStudy(),setStudy:study=>set({study})}));

"use client";
/**
 * Biblioteca padrão de materiais lida do Supabase de login (tabela public.eksteel_materials,
 * leitura só para usuários autenticados). Os dados da Autodesk não ficam no repositório:
 * o administrador aplica o SQL gerado por scripts/build-inventor-materials.cjs.
 * Carrega uma vez por sessão do navegador e é compartilhada por Modelador, Montagem e Simulação.
 */
import {useEffect,useSyncExternalStore} from 'react';
import {createClient} from '@/lib/supabase/client';
import {getBrowserConfig} from '@/lib/supabase/InstallationProvider';
import {validateMaterial,type MaterialDefinition} from './library';

export const MATERIALS_TABLE='eksteel_materials';
export type BuiltInLibraryState={status:'idle'|'loading'|'ready'|'unavailable'|'error';materials:MaterialDefinition[];message:string};

const IDLE:BuiltInLibraryState={status:'idle',materials:[],message:''};
let state=IDLE;
const listeners=new Set<()=>void>();
function publish(next:BuiltInLibraryState){state=next;listeners.forEach(l=>l());}
function subscribe(listener:()=>void){listeners.add(listener);return ()=>{listeners.delete(listener);};}

/** Linhas {definition} do banco; uma linha inválida é descartada sem derrubar a biblioteca inteira. */
export function parseMaterialRows(rows:unknown):MaterialDefinition[]{
  if(!Array.isArray(rows))throw new Error('Resposta inesperada da tabela de materiais.');
  return rows.flatMap(row=>{
    try{return [validateMaterial((row as {definition?:unknown})?.definition)];}catch{return [];}
  });
}

export async function loadBuiltInMaterials(force=false){
  if(!force&&(state.status==='loading'||state.status==='ready'))return;
  if(!getBrowserConfig()&&!(process.env.NEXT_PUBLIC_SUPABASE_URL&&process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)){
    publish({status:'unavailable',materials:[],message:'Autenticação da instalação não configurada: a biblioteca padrão fica indisponível. Importe um .adsklib ou JSON.'});
    return;
  }
  publish({...state,status:'loading',message:''});
  try{
    const client=createClient();
    const {data:session}=await client.auth.getSession();
    if(!session.session){publish({status:'unavailable',materials:[],message:'Entre na sua conta para carregar a biblioteca padrão de materiais.'});return;}
    const {data,error}=await client.from(MATERIALS_TABLE).select('definition').order('name');
    if(error)throw new Error(error.message);
    const materials=parseMaterialRows(data);
    publish({status:'ready',materials,message:materials.length?'':'A biblioteca padrão está vazia no banco. O administrador precisa aplicar o script de materiais (docs/MATERIALS.md).'});
  }catch(e){
    publish({status:'error',materials:[],message:`Não foi possível carregar a biblioteca padrão (${e instanceof Error?e.message:'erro desconhecido'}). Confira se o script de materiais foi aplicado no Supabase de login.`});
  }
}

/** Estado da biblioteca padrão; dispara o carregamento na primeira vez que alguma tela a usa. */
export function useBuiltInMaterials():BuiltInLibraryState{
  const current=useSyncExternalStore(subscribe,()=>state,()=>IDLE);
  useEffect(()=>{void loadBuiltInMaterials();},[]);
  return current;
}

'use client';
import type {ComponentType,ReactNode} from 'react';
import type {Study} from '@/lib/simulation/types';
import {resultFields,type ResultField} from '@/lib/simulation/resultFields';
export type SimulationTab='Geometria'|'Material'|'Malha'|'Contatos'|'Fixações'|'Cargas'|'Resultados';
export function RibbonGroup({label,children}:{label:string;children:ReactNode}){
 return <div className="fea-ribbon-group"><div className="fea-ribbon-commands">{children}</div><span className="fea-ribbon-caption">{label}</span></div>;
}
export function RibbonCommand({label,icon:Icon,onClick,disabled,active,title}:{label:string;icon:ComponentType<{className?:string}>;onClick:()=>void;disabled?:boolean;active?:boolean;title?:string}){
 return <button type="button" className="fea-ribbon-command" disabled={disabled} aria-pressed={active} title={title??label} onClick={onClick}><Icon className="h-7 w-7"/><span>{label}</span></button>;
}
export function StudyBrowser({study,tab,field,onTab,onField}:{study:Study;tab:SimulationTab;field:ResultField;onTab:(tab:SimulationTab)=>void;onField:(field:ResultField)=>void}){
 const rows:{tab:SimulationTab;label:string;items:string[]}[]=[
  {tab:'Geometria',label:'Modelo',items:study.components?.map(c=>c.label)??(study.sourceName?[study.sourceName]:[])},
  {tab:'Material',label:'Materiais',items:[study.material.name]},
  {tab:'Fixações',label:'Restrições',items:study.supports.map((s,i)=>`Fixação ${i+1} · ${s.faceIds.length} face(s)`)},
  {tab:'Cargas',label:'Cargas',items:study.loads.map((l,i)=>`${l.kind==='gravity'?'Gravidade':l.kind==='pressure'?'Pressão':'Força'} ${i+1}`)},
  {tab:'Contatos',label:'Contatos',items:(study.contacts??[]).map((c,i)=>`Contato ${i+1} · ${c.kind==='bonded'?'aderido':'sem atrito'}`)},
  {tab:'Malha',label:'Malha',items:study.mesh?[`${study.mesh.nodes.length.toLocaleString()} nós`,`${study.mesh.tetrahedra.length.toLocaleString()} elementos`]:[]},
 ];
 return <nav className="fea-study-browser" aria-label="Árvore do estudo">
  <div className="fea-pane-heading">Navegador do estudo</div>
  <div className="fea-study-root"><span aria-hidden>▣</span> {study.name||'Estudo estático'}</div>
  <p className="fea-study-kind">Análise estática · mm, N, MPa</p>
  {rows.map(row=><details key={row.tab} open><summary><button type="button" className={tab===row.tab?'is-active':''} onClick={()=>onTab(row.tab)}><span aria-hidden>▱</span> {row.label}<small>{row.items.length}</small></button></summary><div className="fea-tree-children">{row.items.length?row.items.map((item,i)=><button key={i} type="button" title={item} onClick={()=>onTab(row.tab)}>{item}</button>):<span>Não definido</span>}</div></details>)}
  <details open><summary><button type="button" className={tab==='Resultados'?'is-active':''} onClick={()=>onTab('Resultados')}><span aria-hidden>▥</span> Resultados</button></summary><div className="fea-tree-children">{study.results?Object.entries(resultFields).map(([value,label])=><button type="button" key={value} className={field===value?'is-active':''} onClick={()=>onField(value as ResultField)}>{label}</button>):<span>Aguardando solução</span>}</div></details>
 </nav>;
}

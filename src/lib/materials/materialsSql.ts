/**
 * SQL que cria/atualiza public.eksteel_materials no Supabase de login com uma biblioteca
 * de materiais. Usado por scripts/build-inventor-materials.cjs; o arquivo gerado contém os
 * dados da biblioteca e é privado (*.sql é ignorado pelo Git — ver docs/RELEASE_PRIVACY.md).
 */
import {validateMaterial,type MaterialDefinition} from './library';

const literal=(value:string)=>{
  if(value.includes('\0'))throw new Error('Texto com caractere nulo não pode ir para o SQL.');
  return `'${value.replace(/'/g,"''")}'`;
};

export function materialsSql(materials:MaterialDefinition[],library:string,generatedFrom:string):string{
  if(!materials.length)throw new Error('Nenhum material para gravar.');
  if(!/^[\w .-]{1,120}$/.test(library))throw new Error('Nome de biblioteca inválido.');
  const rows=materials.map(validateMaterial).map(m=>`  (${[m.id,library,m.name,m.category].map(literal).join(', ')}, ${literal(JSON.stringify(m))}::jsonb)`);
  return `-- Biblioteca padrão de materiais do Eksteel. Execute no SQL Editor do Supabase de LOGIN
-- (o mesmo projeto usado para entrar no software). Pode ser repetido: atualiza os materiais
-- da biblioteca ${library} e remove os que deixaram de existir nela.
-- Gerado a partir de ${generatedFrom.replace(/[\r\n]/g,' ')} por scripts/build-inventor-materials.cjs.
-- ARQUIVO PRIVADO: contém os dados da biblioteca. Não publicar.
begin;
create table if not exists public.eksteel_materials (
  id text primary key check (char_length(id) between 1 and 200),
  library text not null,
  name text not null,
  category text not null,
  definition jsonb not null check (jsonb_typeof(definition) = 'object'),
  updated_at timestamptz not null default now()
);
alter table public.eksteel_materials enable row level security;
-- Somente leitura para usuários autenticados; ninguém grava pelo aplicativo.
revoke all on public.eksteel_materials from anon, authenticated;
grant select on public.eksteel_materials to authenticated;
drop policy if exists eksteel_materials_read on public.eksteel_materials;
create policy eksteel_materials_read on public.eksteel_materials for select to authenticated using (true);
insert into public.eksteel_materials (id, library, name, category, definition) values
${rows.join(',\n')}
on conflict (id) do update set library = excluded.library, name = excluded.name, category = excluded.category,
  definition = excluded.definition, updated_at = now();
delete from public.eksteel_materials where library = ${literal(library)}
  and id <> all (array[${materials.map(m=>literal(m.id)).join(', ')}]);
notify pgrst, 'reload schema';
commit;
`;
}

-- Execute somente no novo projeto Supabase da emeka_system.
begin;
create table public.emeka_audits (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 200),
  department text not null default '' check (char_length(department) <= 200),
  notes text not null default '' check (char_length(notes) <= 10000),
  status text not null default 'planejada' check (status in ('planejada', 'em_andamento', 'concluida')),
  created_at timestamptz not null default now()
);
create index emeka_audits_owner_created on public.emeka_audits(owner_id, created_at desc);
alter table public.emeka_audits enable row level security;
revoke all on public.emeka_audits from anon, authenticated;
grant select, insert, update on public.emeka_audits to authenticated;
create policy audits_read on public.emeka_audits for select to authenticated using ((select auth.uid()) = owner_id);
create policy audits_create on public.emeka_audits for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy audits_update on public.emeka_audits for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
-- Nomes técnicos preservados para compatibilidade com os módulos existentes.
create table public.eksteel_cad_current (
  owner_id uuid not null references auth.users(id) on delete cascade,
  folder_name text not null,
  project_name text not null,
  revision_token text not null,
  body text not null,
  primary key (owner_id, folder_name, project_name)
);
alter table public.eksteel_cad_current enable row level security;
revoke all on public.eksteel_cad_current from anon, authenticated;
grant select, insert, update on public.eksteel_cad_current to authenticated;
create policy cad_current_owner on public.eksteel_cad_current for all to authenticated
using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);

create table public.eksteel_cad_documents (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  folder_name text not null,
  source_name text not null,
  filename text not null,
  kind text not null check (kind in ('part','assembly','drawing','pdf','dxf')),
  object_path text not null unique,
  byte_size bigint not null check (byte_size > 0 and byte_size <= 52428800),
  created_at timestamptz not null default now(),
  purpose text not null default '' check (char_length(purpose) <= 500),
  check (split_part(object_path, '/', 1) = owner_id::text)
);
create index emeka_documents_owner_folder on public.eksteel_cad_documents(owner_id, folder_name, created_at desc);
alter table public.eksteel_cad_documents enable row level security;
revoke all on public.eksteel_cad_documents from anon, authenticated;
grant select, insert on public.eksteel_cad_documents to authenticated;
create policy emeka_documents_read on public.eksteel_cad_documents for select to authenticated using ((select auth.uid()) = owner_id);
create policy emeka_documents_insert on public.eksteel_cad_documents for insert to authenticated with check ((select auth.uid()) = owner_id);

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types) values
('cad-projects', 'cad-projects', false, 52428800, array['application/json']),
('cad-documents', 'cad-documents', false, 52428800, array['application/octet-stream']);
-- Revisões e documentos são imutáveis pelo aplicativo.
create policy emeka_storage_read on storage.objects for select to authenticated
using (bucket_id in ('cad-projects','cad-documents') and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy emeka_storage_insert on storage.objects for insert to authenticated
with check (bucket_id in ('cad-projects','cad-documents') and (storage.foldername(name))[1] = (select auth.uid())::text);

create table public.eksteel_materials (
  id text primary key check (char_length(id) between 1 and 200),
  library text not null,
  name text not null,
  category text not null,
  definition jsonb not null check (jsonb_typeof(definition) = 'object'),
  updated_at timestamptz not null default now()
);
alter table public.eksteel_materials enable row level security;
revoke all on public.eksteel_materials from anon, authenticated;
grant select on public.eksteel_materials to authenticated;
create policy eksteel_materials_read on public.eksteel_materials for select to authenticated using (true);
notify pgrst, 'reload schema';
commit;

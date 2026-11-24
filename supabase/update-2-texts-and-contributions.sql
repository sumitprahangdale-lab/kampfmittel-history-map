-- Update 2: text archive + visitor contributions.
-- Run once in Supabase → SQL Editor → New query → paste → Run.

-- Text archive: the full text of every page of your documents, searchable later. Only the owner can read or write it.
create table if not exists public.texts (
  source_id text not null,
  page      int  not null,
  title     text,
  body      text not null,
  primary key (source_id, page)
);
create index if not exists texts_search on public.texts using gin (to_tsvector('simple', body));
alter table public.texts enable row level security;
drop policy if exists "texts owner" on public.texts;
create policy "texts owner" on public.texts for all using (public.is_owner()) with check (public.is_owner());

-- Visitor contributions: visitors may only ADD a contribution (dates, places, forces, short quotes found in their documents).
-- Nobody but the owner can read, change or delete them. Nothing appears on the map until the owner accepts it.
create table if not exists public.contributions (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  doc_title  text not null check (char_length(doc_title) <= 300),
  events     jsonb not null check (jsonb_typeof(events) = 'array' and jsonb_array_length(events) <= 2000 and pg_column_size(events) < 1500000),
  snippets   text check (char_length(snippets) <= 200000),
  note       text check (char_length(note) <= 1000)
);
alter table public.contributions enable row level security;
drop policy if exists "contrib insert" on public.contributions;
drop policy if exists "contrib owner"  on public.contributions;
drop policy if exists "contrib delete" on public.contributions;
create policy "contrib insert" on public.contributions for insert with check (true);
create policy "contrib owner"  on public.contributions for select using (public.is_owner());
create policy "contrib delete" on public.contributions for delete using (public.is_owner());

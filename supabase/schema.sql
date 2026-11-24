-- Kampfmittel History Map: database, file storage and rules.
-- Run this once in Supabase → SQL Editor → New query → paste → Run.

-- 1. One table for events, sources and ordnance (same structure the map uses).
create table if not exists public.docs (
  collection text not null check (collection in ('events','sources','ordnance')),
  id         text not null,
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (collection, id)
);

-- 2. Who the owner is. Filled in step 5 below.
create table if not exists public.app_owner (user_id uuid primary key references auth.users(id) on delete cascade);
alter table public.app_owner enable row level security;   -- no policies: nobody can read or change it from the website

create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_owner where user_id = auth.uid());
$$;
grant execute on function public.is_owner() to anon, authenticated;

-- 3. Rules: everyone may READ the map data; only the owner may write.
alter table public.docs enable row level security;
drop policy if exists "docs read"   on public.docs;
drop policy if exists "docs insert" on public.docs;
drop policy if exists "docs update" on public.docs;
drop policy if exists "docs delete" on public.docs;
create policy "docs read"   on public.docs for select using (true);
-- To make the whole map private (only you can see it), use this instead of the line above:
-- create policy "docs read" on public.docs for select using (public.is_owner());
create policy "docs insert" on public.docs for insert with check (public.is_owner());
create policy "docs update" on public.docs for update using (public.is_owner()) with check (public.is_owner());
create policy "docs delete" on public.docs for delete using (public.is_owner());

-- 4. Private file storage for your PDFs and page texts: only the owner can read or write.
insert into storage.buckets (id, name, public, file_size_limit)
values ('files', 'files', false, 52428800)
on conflict (id) do nothing;
drop policy if exists "files owner read"   on storage.objects;
drop policy if exists "files owner insert" on storage.objects;
drop policy if exists "files owner update" on storage.objects;
drop policy if exists "files owner delete" on storage.objects;
create policy "files owner read"   on storage.objects for select using (bucket_id = 'files' and public.is_owner());
create policy "files owner insert" on storage.objects for insert with check (bucket_id = 'files' and public.is_owner());
create policy "files owner update" on storage.objects for update using (bucket_id = 'files' and public.is_owner());
create policy "files owner delete" on storage.objects for delete using (bucket_id = 'files' and public.is_owner());

-- 5. AFTER you have created your user (Authentication → Users → Add user), run this line
--    with your own e-mail address to make that user the owner:
-- insert into public.app_owner (user_id) select id from auth.users where email = 'you@example.com';
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

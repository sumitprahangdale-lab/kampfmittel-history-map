-- Update 3: visitor sign-up (name + company before using the map).
-- Run once in Supabase → SQL Editor → New query → paste → Run.
-- Visitors can only ADD their entry. Only the owner can read or delete the list.
create table if not exists public.visitors (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name       text not null check (char_length(name) between 2 and 120),
  company    text check (company is null or char_length(company) <= 160),
  role       text check (char_length(role) <= 120),
  email      text check (char_length(email) <= 200),
  lang       text check (char_length(lang) <= 20)
);
alter table public.visitors enable row level security;
drop policy if exists "visitor insert" on public.visitors;
drop policy if exists "visitor owner"  on public.visitors;
drop policy if exists "visitor delete" on public.visitors;
create policy "visitor insert" on public.visitors for insert with check (true);
create policy "visitor owner"  on public.visitors for select using (public.is_owner());
create policy "visitor delete" on public.visitors for delete using (public.is_owner());
-- If you ran an earlier version of this file, this makes the company optional:
alter table public.visitors alter column company drop not null;
alter table public.visitors drop constraint if exists visitors_company_check;
alter table public.visitors add constraint visitors_company_check check (company is null or char_length(company) <= 160);

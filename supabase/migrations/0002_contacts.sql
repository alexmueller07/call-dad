-- callhome contacts: per-user address book for the phone app.
-- Run this in the Supabase SQL editor once (like 0001_init.sql).
-- Unlike profiles/calls, users get full CRUD on THEIR OWN contacts via RLS.

create table if not exists public.contacts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  name         text not null,
  phone_number text not null,
  created_at   timestamptz not null default now()
);

alter table public.contacts enable row level security;

create policy "contacts: read own"
  on public.contacts for select using (auth.uid() = user_id);
create policy "contacts: insert own"
  on public.contacts for insert with check (auth.uid() = user_id);
create policy "contacts: update own"
  on public.contacts for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "contacts: delete own"
  on public.contacts for delete using (auth.uid() = user_id);

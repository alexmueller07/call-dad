-- callhome initial schema: prepaid accounts, top-ups, and call history.
-- Run this in the Supabase SQL editor (or `supabase db push`) once per project.
--
-- Security model: users may only READ their own rows (RLS policies below). No
-- client write policies exist on purpose — the balance must never be settable
-- from the browser. All money changes go through the server using the
-- service-role key (see lib/supabase/admin.ts), which bypasses RLS.

-- ---------------------------------------------------------------------------
-- profiles: one row per auth user, holds the prepaid balance.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  email         text,
  balance_cents integer not null default 0 check (balance_cents >= 0),
  created_at    timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles: read own"
  on public.profiles for select
  using (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- top_ups: an audit row per successful Stripe payment that added credit.
-- ---------------------------------------------------------------------------
create table if not exists public.top_ups (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references public.profiles (id) on delete cascade,
  stripe_payment_intent  text unique,
  amount_cents           integer not null check (amount_cents > 0),
  created_at             timestamptz not null default now()
);

alter table public.top_ups enable row level security;

create policy "top_ups: read own"
  on public.top_ups for select
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- calls: one row per placed call, written authoritatively from the Twilio
-- status callback (final duration + cost).
-- ---------------------------------------------------------------------------
create table if not exists public.calls (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  to_number       text not null,
  country         text,
  seconds         integer not null default 0,
  cost_cents      integer not null default 0,
  twilio_call_sid text unique,
  created_at      timestamptz not null default now()
);

alter table public.calls enable row level security;

create policy "calls: read own"
  on public.calls for select
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Auto-create a profile row whenever a new auth user signs up. SECURITY DEFINER
-- lets the trigger insert into profiles regardless of the caller's RLS.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

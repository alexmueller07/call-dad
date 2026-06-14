-- Switch the prepaid model from money to CALL TIME. Because the packages are
-- priced as bulk discounts (30m=$5, 60m=$7, 120m=$12, then 10c/min), we must
-- store the time bought, not dollars. Run after 0001/0002.

-- Seconds of call time the user has left.
alter table public.profiles
  add column if not exists balance_seconds integer not null default 0
  check (balance_seconds >= 0);

-- How much time a given purchase granted (price stays in top_ups.amount_cents).
alter table public.top_ups
  add column if not exists seconds_added integer not null default 0;

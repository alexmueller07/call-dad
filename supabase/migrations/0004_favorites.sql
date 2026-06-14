-- Favorites: let users star contacts to pin them to the top.
-- Run after 0001–0003. The app works without this (it falls back gracefully);
-- run it so starred favorites persist.

alter table public.contacts
  add column if not exists is_favorite boolean not null default false;

-- Hosted products was created before hardening; admin upserts always send this column.
alter table public.products
  add column if not exists min_contribution_minor integer not null default 30;

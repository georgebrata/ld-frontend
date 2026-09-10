-- Admin allowlist, one-shot registration flag, and product change audit.
-- ADMIN_REGISTERED = true means the /admin/register page is open.
-- The admin Edge Function flips it to false after the first successful register.
-- Browser roles have no table access; Edge Functions use the service role.

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  role text not null default 'admin' check (role in ('admin')),
  disabled_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists admin_users_email_idx on public.admin_users (lower(email));

alter table public.admin_users enable row level security;
revoke all on table public.admin_users from anon, authenticated, public;
grant all on table public.admin_users to service_role;

create table if not exists public.app_flags (
  name text primary key,
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.app_flags enable row level security;
revoke all on table public.app_flags from anon, authenticated, public;
grant all on table public.app_flags to service_role;

insert into public.app_flags (name, enabled)
values ('ADMIN_REGISTERED', true)
on conflict (name) do nothing;

create table if not exists public.product_audit (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid,
  actor_email text,
  action text not null check (action in ('create', 'update', 'delete', 'reorder', 'refresh')),
  product_id text,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);

create index if not exists product_audit_product_idx
  on public.product_audit (product_id, created_at desc);

alter table public.product_audit enable row level security;
revoke all on table public.product_audit from anon, authenticated, public;
grant all on table public.product_audit to service_role;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.set_updated_at() from public, anon, authenticated;

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
before update on public.products
for each row execute procedure public.set_updated_at();

drop trigger if exists app_flags_set_updated_at on public.app_flags;
create trigger app_flags_set_updated_at
before update on public.app_flags
for each row execute procedure public.set_updated_at();

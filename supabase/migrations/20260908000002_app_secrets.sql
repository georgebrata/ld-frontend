-- Optional runtime secrets overlay. Deno.env still wins when set.
-- Browser roles have no access. Edge Functions read via the service role.

create table if not exists public.app_secrets (
  name text primary key,
  value text not null,
  updated_at timestamptz not null default now(),
  constraint app_secrets_name_allowed check (
    name in (
      'SITE_URL',
      'CORS_ALLOW_ORIGINS',
      'RETAIL_CURRENCY',
      'PROVIDER_CURRENCY',
      'FX_PROVIDER_TO_RETAIL',
      'MARKUP_MULTIPLIER',
      'RETAIL_CATALOGUE_URL',
      'SOCIALPANEL24_API_KEY',
      'SOCIALPANEL24_TIMEOUT_MS',
      'SOCIALPANEL24_ENABLED',
      'PROVIDER_ENV',
      'STRIPE_SECRET_KEY',
      'STRIPE_WEBHOOK_SECRET',
      'RESEND_API_KEY',
      'FROM_EMAIL',
      'FROM_NAME',
      'REPLY_TO_EMAIL',
      'OWNER_EMAIL',
      'SUPPORT_EMAIL',
      'WORKER_SECRET',
      'ORDER_ID_PREFIX',
      'CATALOGUE_TIMEOUT_MS',
      'APP_FUNCTIONS_URL'
    )
  )
);

alter table public.app_secrets enable row level security;

revoke all on table public.app_secrets from public, anon, authenticated;

insert into public.app_secrets (name, value)
values
  ('SITE_URL', 'https://like-dealer.com'),
  (
    'CORS_ALLOW_ORIGINS',
    'https://like-dealer.com,http://localhost:3000,http://127.0.0.1:3000'
  ),
  ('RETAIL_CURRENCY', 'USD'),
  ('PROVIDER_CURRENCY', 'USD'),
  ('FX_PROVIDER_TO_RETAIL', '1'),
  ('MARKUP_MULTIPLIER', '2'),
  ('PROVIDER_ENV', 'test'),
  ('SOCIALPANEL24_ENABLED', 'true'),
  ('ORDER_ID_PREFIX', 'LD-'),
  ('FROM_EMAIL', 'orders@like-dealer.com'),
  ('FROM_NAME', 'LikeDealer'),
  ('REPLY_TO_EMAIL', 'support@like-dealer.com'),
  ('OWNER_EMAIL', 'owner@like-dealer.com'),
  ('SUPPORT_EMAIL', 'support@like-dealer.com'),
  ('APP_FUNCTIONS_URL', 'https://xvrvxofujpqavgnprpmq.supabase.co/functions/v1')
on conflict (name) do nothing;

insert into public.app_secrets (name, value)
select 'WORKER_SECRET', encode(gen_random_bytes(32), 'hex')
where not exists (select 1 from public.app_secrets where name = 'WORKER_SECRET');

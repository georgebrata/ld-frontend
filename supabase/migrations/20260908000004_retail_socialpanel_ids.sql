-- Allow overlay JSON for provider service ids. Deno.env still wins.
-- Values are SocialPanel24 service numbers, not API keys.

alter table public.app_secrets drop constraint if exists app_secrets_name_allowed;

alter table public.app_secrets add constraint app_secrets_name_allowed check (
  name in (
    'SITE_URL',
    'CORS_ALLOW_ORIGINS',
    'RETAIL_CURRENCY',
    'PROVIDER_CURRENCY',
    'FX_PROVIDER_TO_RETAIL',
    'MARKUP_MULTIPLIER',
    'RETAIL_CATALOGUE_URL',
    'RETAIL_SOCIALPANEL_IDS',
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
);

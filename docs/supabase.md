# Supabase

## Project

1. Create a project.
2. Apply `supabase/migrations/20260908000001_init.sql`, then `20260908000002_app_secrets.sql`, `20260908000003_job_cron.sql`, and `20260908225422_catalogue_cron.sql`.
3. Set secrets from `supabase/.env.example` (`supabase secrets set`) **or** insert into `public.app_secrets` (RLS on; no browser grants). Non-empty `Deno.env` wins.
4. Deploy functions. Guest functions and the Stripe webhook use `verify_jwt = false` in `supabase/config.toml`.
5. `pg_cron` runs `select public.kick_process_jobs()` every minute and `select public.kick_refresh_catalogue()` daily at 06:00 UTC. You can also `POST process-jobs` or `POST refresh-catalogue` with `Authorization: Bearer $WORKER_SECRET`.

## Tables (private)

`orders`, `stripe_events`, `jobs`, plus optional `catalogue_cache`, `rate_limits`, and `app_secrets`.

RLS is enabled. `anon` / `authenticated` have **no** table grants and cannot execute `apply_stripe_payment_event`, `claim_jobs`, or `consume_rate_limit`. All writes use the service role inside Edge Functions. Guests do not create Auth users.

## Orders

Immutable service/input/price snapshot, integer `amount_minor`, email, timestamps, Stripe ids, **separate** `payment_status` and `fulfillment_status`, `provider_service_id`, `provider_type`, `provider_payload`, `provider_order_id`, dispatch time, raw provider status, charge/currency, start count, remains, last status check, capability hash, checkout attempt id.

## Jobs

`task`, unique `dedupe_key`, attempts, `next_retry_at`, lease, outcome, `external_ref` (Resend id or provider order id).

## CORS

Allowlisted origins (`CORS_ALLOW_ORIGINS` / `SITE_URL`). Local `http(s)://localhost` and `127.0.0.1` on any port are also accepted so `python3 -m http.server` works. CORS is not authentication.

## Rate limits

Persistent via `consume_rate_limit`: catalogue 60/min, create-checkout 10/min, order-status 30/min, per client IP.

## Local

```bash
npx supabase start
npx supabase db reset
npx supabase secrets set --env-file supabase/.env
npx supabase functions serve --no-verify-jwt
```

Set `js/config.js` `SUPABASE_FUNCTIONS_URL` to `http://127.0.0.1:54321/functions/v1`.

## Existing data

Worker KV and Google Sheets orders are not migrated. Export them if you still need history; this schema does not delete those systems.

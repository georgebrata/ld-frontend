# Supabase

## Project

1. Create a project.
2. Apply **all** files in `supabase/migrations/` in filename order (through `20260910000002_ops_agent.sql`).
3. Set secrets from `supabase/.env.example` (`supabase secrets set`) **or** insert into `public.app_secrets` (RLS on; no browser grants). Non-empty `Deno.env` wins. Prefer hosted function secrets over `app_secrets` for keys.
4. Deploy functions listed in `supabase/config.toml` (`catalogue`, `create-checkout`, `stripe-webhook`, `order-status`, `process-jobs`, `refresh-catalogue`, `health`, `operator`, `resend-webhook`).
5. `pg_cron` runs `select public.kick_process_jobs()` every minute, `select public.kick_refresh_catalogue()` daily at 06:00 UTC, and `select public.purge_retained_rows()` hourly when the extension exists.

## Tables (private)

Operational tables stay in `public` with RLS enabled and **no** `anon` / `authenticated` grants: `orders`, `stripe_events`, `jobs`, `products`, `catalogue_cache`, `rate_limits`, `app_secrets`, `external_requests`, `order_events`, `operator_actions`, `job_attempts`, `retention_settings`.

Sanitized read views live in schema `agent` (`queue_health`, `order_states`, `catalogue_anomalies`) — no emails, comments, tokens, or targets. Service role only.

Guests do not create Auth users. All writes use the service role inside Edge Functions.

## Orders

Immutable service/input/price snapshot, integer `amount_minor`, expected provider cost/contribution, email, timestamps, Stripe ids (`cs_` sessions only), **separate** `payment_status` and `fulfillment_status`.

## Jobs

`task`, unique `dedupe_key`, `attempts` / `max_attempts`, `next_retry_at`, lease, outcome, `external_ref`. Claims skip rows at `max_attempts`. Polling coalesces to one `poll:batch` status scan per worker run.

## CORS

Allowlisted origins (`CORS_ALLOW_ORIGINS` / `SITE_URL`). Local `http(s)://localhost` and `127.0.0.1` on any port are also accepted so `python3 -m http.server` works. CORS is not authentication.

## Rate limits

Persistent via `consume_rate_limit`: catalogue 60/min, create-checkout 10/min, order-status 30/min, per client IP. Expired buckets are purged.

## Local

```bash
npx supabase@2.58.5 start
npx supabase@2.58.5 db reset
npx supabase@2.58.5 secrets set --env-file supabase/.env
npx supabase@2.58.5 functions serve --no-verify-jwt
```

Set `js/config.js` `SUPABASE_FUNCTIONS_URL` to `http://127.0.0.1:54321/functions/v1`.

## Existing data

Worker KV and Google Sheets orders are not migrated. Export them if you still need history; this schema does not delete those systems.

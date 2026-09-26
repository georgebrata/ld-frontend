# Deploy checklist (post–audit remediation)

## Database

1. Apply [`supabase/migrations/20260913000001_audit_remediation.sql`](../supabase/migrations/20260913000001_audit_remediation.sql) forward-only (hosted: already applied via migration `audit_remediation` when using project MCP).

## Edge Functions (all ten, from git)

```bash
supabase login   # or export SUPABASE_ACCESS_TOKEN
cd /path/to/ld-frontend
npx supabase@2.58.5 functions deploy \
  catalogue create-checkout stripe-webhook order-status process-jobs \
  refresh-catalogue health operator resend-webhook admin \
  --no-verify-jwt --project-ref xvrvxofujpqavgnprpmq
```

Every slug uses custom auth; keep `verify_jwt=false`.

## Secrets and cron

- `SOCIALPANEL24_ENABLED`: set only in **Edge Function secrets** (`false` until go-live). Not in `app_secrets`.
- `WORKER_SECRET` and `APP_FUNCTIONS_URL`: must exist in **`public.app_secrets`** for pg_cron (same values as function secrets).

## Static site

```bash
npm run build
# publish dist/ to Vercel (includes /admin/orders/, vercel.json headers)
```

## Smoke

```bash
export SUPABASE_FUNCTIONS_URL=https://xvrvxofujpqavgnprpmq.supabase.co/functions/v1
export SUPABASE_ANON_KEY=<anon>
npm run smoke:deploy
```

## Operator (not in repo)

- Resend: DNS + webhook → `resend-webhook`, `RESEND_WEBHOOK_SECRET`
- Stripe: restricted key, Dashboard events per `third-party-setup.md`
- Supabase Auth: enable leaked-password protection

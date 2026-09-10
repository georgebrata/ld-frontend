# Release

1. `npm ci && npm test && npm run build:check`
2. Apply all migrations in filename order (`npx supabase db push` or SQL editor). Confirm `20260910000001_hardening.sql`, `20260910000002_ops_agent.sql`, and `20260910000003_admin.sql`.
3. Deploy Edge Functions including `health`, `operator`, `resend-webhook`, and `admin`. Disable public Auth signup on the hosted project. Open `/admin/register/` once while `ADMIN_REGISTERED` is true, then sign in at `/admin/`.
4. Publish **only** `dist/` to the static host.
5. Keep `SOCIALPANEL24_ENABLED=false` until Stripe live mode, `PROVIDER_ENV=live`, and `APP_ENV=production` are intentional.
6. Record Git SHA + migration version. Roll back by republishing the previous `dist/` and function bundle.

Canary: one mapped service, Stripe test mode, fake or disabled provider. Rollback if payment mismatch, queue age, unknown submissions, email failures, or margin-floor quotes spike.

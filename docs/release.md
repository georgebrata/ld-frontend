# Release

1. `npm ci && npm test && npm run build:check`
2. Apply all migrations in filename order (`npx supabase db push` or SQL editor). Confirm `20260910000001_hardening.sql` and `20260910000002_ops_agent.sql`.
3. Deploy Edge Functions including `health`, `operator`, and `resend-webhook`.
4. Publish **only** `dist/` to the static host.
5. Keep `SOCIALPANEL24_ENABLED=false` until Stripe live mode, `PROVIDER_ENV=live`, and `APP_ENV=production` are intentional.
6. Record Git SHA + migration version. Roll back by republishing the previous `dist/` and function bundle.

Canary: one mapped service, Stripe test mode, fake or disabled provider. Rollback if payment mismatch, queue age, unknown submissions, email failures, or margin-floor quotes spike.

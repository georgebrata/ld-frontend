# Observability

Public `GET /functions/v1/health` is a liveness probe (no secrets). `POST` with `WORKER_SECRET` returns queue counts and alert names. Logs are redacted: no capability tokens, comments, emails, raw targets, or vendor keys.

## Signals to watch

| Signal | Where |
|--------|--------|
| Webhook rejects / mismatches | `stripe_events.outcome=rejected`, Edge logs `webhook mismatch` |
| Queue age / dead letters | `jobs.status=failed`, `attempts >= max_attempts` |
| Unknown submissions | `fulfillment_status=submission_unknown` |
| Deferred paid work | `fulfillment_status=deferred` (provider disabled or kill switch) |
| Resend acceptance vs delivery | `customer_email_state` `accepted` until `resend-webhook` |
| Contribution | `orders.expected_contribution_minor` vs later `provider_charge` |
| Function cost | Supabase dashboard invocations (1,440 `process-jobs`/day from cron) |

Independent dashboards are not provisioned in-repo. Wire these fields to your log sink. Alert when `POST /health` includes `jobs_failed`, `submission_unknown`, `queue_backlog`, or `fulfillment_deferred`.

Correlation: pass `X-Request-Id` / `X-Correlation-Id`; otherwise functions generate a UUID (`correlationId()` in `http.js`).

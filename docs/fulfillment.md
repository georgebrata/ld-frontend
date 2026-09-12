# Fulfilment

Worker: Edge Function `process-jobs`, claimed from `jobs` with `FOR UPDATE SKIP LOCKED`. Authenticate with `WORKER_SECRET`. Schedule every minute ([Supabase cron](https://supabase.com/docs/guides/functions/schedule-functions)). Optional immediate invoke after webhook commit is best-effort only.

## Submit (`fulfill`)

1. Claim the unique `fulfill:{orderId}` job.
2. Require `payment_status=paid` and no `provider_order_id`.
3. If status is already `submission_unknown` or `blocked_balance`, do not `add`.
4. If status is `dispatching` (expired lease after the HTTP call may have been sent), move to `submission_unknown`, notify the owner, **do not** `add`.
5. Persist `dispatching` + `provider_dispatched_at` **before** `action=add`.
6. Valid `{ "order": 23501 }` → store id, `submitted`, enqueue `poll:batch`.
7. Definite validation rejection → `failed`, no automatic `add`.
8. Insufficient balance → `blocked_balance`, owner alert, no automatic `add`, customer charge unchanged.
9. Timeout, malformed JSON, crash, or HTTP 5xx after dispatch → `submission_unknown`, owner alert, **no automatic `add`**.
10. Test-mode Stripe → `skipped_test_mode` (never live `add`).
11. Provider disabled / not live / non-production → `deferred` and the fulfill job is retried. Do not mark skipped.

There is no provider idempotency key. Do not invent one. Do not promise exactly-once external submission.

## Unknown submission — operator steps

Use `POST /functions/v1/operator` with `X-Operator-Approved: true` (see [runbooks.md](./runbooks.md)):

1. In SocialPanel24, search by time window and target link/username.
2. If an order exists: `attach_provider_order_id`.
3. If you can prove non-acceptance: `mark_provider_nonacceptance`. Refunds are a separate `propose_refund` (recorded only; Stripe refund is human).
4. Never requeue `add` while `dispatching` or `submission_unknown`.

## Poll

One scheduled batch per worker run (`poll:batch`), `action=status`, batches of ≤100. Store `status`, `charge`, `start_count`, `remains`, `currency` (provider charge ≠ Stripe revenue). Map `In progress` → `in_progress`, `Partial` → `partial`. Completed UI requires an affirmative Completed. Unfamiliar strings → `review`. Stop on terminal states. Polling older than 14 days moves to `review`. Partial/cancelled need operator refund review — no automatic resubmit.

Entry: `supabase/functions/_shared/fulfillment.js`, `jobs.js`.

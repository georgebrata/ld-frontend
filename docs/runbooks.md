# Operator runbooks

Consequential actions require a human-approved operator command (`POST /functions/v1/operator` with `X-Operator-Approved: true`). Agents may only **propose**.

## Provider unknown submission

1. Search SocialPanel24 by time and target. Do not `add` again.
2. If found: `attach_provider_order_id`.
3. If confirmed not accepted: `mark_provider_nonacceptance`.
4. Refunds are a separate `propose_refund` after Stripe review.

## Provider disabled / deferred paid orders

Paid live orders stay `fulfillment_status=deferred` and the fulfill job retries. Re-enable `SOCIALPANEL24_ENABLED=true` only in production with `PROVIDER_ENV=live` and `APP_ENV=production`.

## Kill switch

`provider_kill_switch` is a proposal until approved. It must not mark paid work skipped.

## Webhook mismatch (409)

Inspect `stripe_events.outcome=rejected` and `mismatch`. Replay is allowed until the event is accepted. Never write `pi_` ids into `stripe_session_id`.

## Queue exhaustion

`claim_jobs` ignores rows at `max_attempts`. Inspect `jobs.status=failed`, then `replay_job` after fixing the cause.

## Key rotation

Rotate Stripe, Resend, SocialPanel24, and `WORKER_SECRET` in hosted function secrets (preferred) rather than `app_secrets`. Invalidate old webhook endpoints.

## Restore / rollback

Record the Git SHA and migration version in the deploy notes. Restore Postgres from PITR, redeploy the matching function bundle, and publish the matching `dist/` artifact. Do not mix a new storefront with an old webhook parser.

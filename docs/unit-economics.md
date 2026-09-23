# Unit economics

Do not invent list prices. Fill this from live invoices and `orders` rows.

## Contribution per paid order

`net = amount_minor - expected_provider_cost_minor - stripe_fees - email_marginal - compute_marginal - expected_refund_share`

Store at checkout:

- `expected_provider_cost_minor`
- `expected_contribution_minor`
- `fx_provider_to_retail`
- `min_contribution_minor`

Reconcile later against `provider_charge` / `provider_currency`.

The quote path now raises the selling price when contribution would fall below the floor (default 30¢ plus an estimated Stripe fixed+percentage fee). Changing `products.markup_multiplier` does not by itself change already-snapshotted orders.

## Live snapshot (10 September 2026)

| Integration | Evidence | Notes |
|---|---|---|
| Stripe | MCP test account `acct_1UDTnBGhzw6b0usk` (`LD sandbox`, livemode=false) | Webhook `we_1UDUSdGhzw6b0uskoWV1lEej` (`LikeDealer guest checkout (test)`, enabled) for Checkout + `payment_intent.payment_failed` → `https://xvrvxofujpqavgnprpmq.supabase.co/functions/v1/stripe-webhook`. `api_version` on the endpoint is unset (code pins `2026-07-29.dahlia` on API calls). Standard US card fees are typically 2.9% + 30¢; **do not treat that as this account’s contract** until the Dashboard fee schedule is exported. |
| Stripe docs | Historical CLI sandbox `acct_1UDULIDDSooeTCXK` / claim URL | Treat as expired/secret; do not reuse. Rotate webhook secrets after claiming a durable account. |
| Supabase | Project ref `xvrvxofujpqavgnprpmq` in `js/config.js` | Live MCP was not authenticated in this pass. Confirm applied migrations including `20260910000002_ops_agent.sql` before enabling live provider `add`. |
| Resend | Docs: domain created, DNS not verified as of 8 Sep 2026 | Sender may still be `orders@solon.agency`. Add delivery webhooks after DNS. |
| SocialPanel24 | No sandbox in-repo | Test Stripe previously created live order `119674166`. Keep `SOCIALPANEL24_ENABLED=false` until production identity is explicit. |
| Hosting | Unspecified static/FTP | Publish **`dist/` only**. Do not upload `supabase/`, `worker/`, `test/`, or `.env`. |
| Cost amplifiers | Cron every minute, duplicate poll jobs (fixed), abandoned sessions, two emails/paid order | Measure Edge invocations and provider status calls after deploy. |

## Cost amplifiers to watch

- 1,440 empty `process-jobs` invocations/day
- Provider status scans (now one batch per worker run)
- Unpaid checkout rows and Stripe sessions
- Persistent `rate_limits` rows (purge helper added)
- Rendered email bodies (no longer stored on retry payloads)

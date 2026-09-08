# Stripe

Server-only Checkout Sessions in `mode=payment`. The browser redirects to `session.url`. Return URLs are never payment proof.

## Create

`supabase/functions/_shared/stripe.js` posts `application/x-www-form-urlencoded` with a stable Idempotency-Key. Line item `unit_amount` is the server quote in currency minor units. Metadata: `internalOrderId`, `checkoutAttemptId`, `serviceId`.

Success: `{returnOrigin}/success/?session_id={CHECKOUT_SESSION_ID}`  
Cancel: `{returnOrigin}/cancel/?attempt=…` (attempt id is not an auth token; the capability token stays in sessionStorage).

`returnOrigin` is the request `Origin` when it is `SITE_URL`, on the CORS allowlist, or a local `localhost` / `127.0.0.1` static server. Anything else falls back to `SITE_URL`. That keeps the capability token on the same origin that started checkout.

## Webhook

`stripe-webhook` reads the **raw** body, verifies `Stripe-Signature` with `STRIPE_WEBHOOK_SECRET`, then calls `apply_stripe_payment_event`.

`checkout.session.completed` is paid **only** when `payment_status === "paid"`. Also handle `async_payment_succeeded`, `async_payment_failed`, `expired`. Verify stored session, amount, currency. Late events cannot move `paid` backwards.

A transition **into** `paid` enqueues exactly one `fulfill` job and separate customer/owner email jobs (unique `dedupe_key`). Unpaid/expired/failed events do not enqueue those jobs.

Return 2xx after durable commit; 5xx if persistence fails so Stripe retries. Do not call SocialPanel24 or Resend in this handler. Best-effort `process-jobs` kick after commit; Cron is the fallback.

Test-mode events (`livemode=false`) must not reach a live provider (`PROVIDER_ENV=live` → fulfilment `skipped_test_mode`).

Endpoint: `https://<project>.supabase.co/functions/v1/stripe-webhook`

The LD sandbox test endpoint is already created at  
`https://xvrvxofujpqavgnprpmq.supabase.co/functions/v1/stripe-webhook`.

Checkout Sessions are created with a restricted test key in `app_secrets` (`STRIPE_SECRET_KEY`) from Stripe CLI sandbox `acct_1UDULIDDSooeTCXK`. That sandbox expires **2026-09-15** unless claimed:

https://dashboard.stripe.com/onboard_sandbox/YWNjdF8xVURVTElERFNvb2VUQ1hLLDE3ODk1MDIyNjcv100cUtrrKDN

Webhook `we_1UDVKODDSooeTCXK56bgztdl` is on that account. Its signing secret is stored in `app_secrets.STRIPE_WEBHOOK_SECRET` (rotated when the endpoint was recreated; do not reuse the earlier MCP sandbox secret).

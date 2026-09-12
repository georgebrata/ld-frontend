# Stripe

Server-only Checkout Sessions in `mode=payment`. The browser redirects to `session.url`. Return URLs are never payment proof.

## Create

`supabase/functions/_shared/stripe.js` posts `application/x-www-form-urlencoded` with a stable Idempotency-Key. Line item `unit_amount` is the server quote in currency minor units. Metadata: `internalOrderId`, `checkoutAttemptId`, `serviceId`.

Success: `{returnOrigin}/success/?session_id={CHECKOUT_SESSION_ID}`  
Cancel: `{returnOrigin}/cancel/?attempt=…` (attempt id is not an auth token; the capability token stays in sessionStorage).

`returnOrigin` is the request `Origin` when it is `SITE_URL`, on the CORS allowlist, or a local `localhost` / `127.0.0.1` static server. Anything else falls back to `SITE_URL`. That keeps the capability token on the same origin that started checkout.

## Webhook

`stripe-webhook` reads the **raw** body, verifies `Stripe-Signature` with `STRIPE_WEBHOOK_SECRET` **and a 300s timestamp tolerance**, then calls `apply_stripe_payment_event`.

`checkout.session.completed` is paid **only** when `payment_status === "paid"`. Also handle `async_payment_succeeded`, `async_payment_failed`, `expired`. `payment_intent.payment_failed` looks up the order by metadata / PaymentIntent id and **must not** write `pi_` into `stripe_session_id`. Verify stored session, amount, currency. Late events cannot move `paid` backwards. Mismatches are stored as `outcome=rejected` and remain replayable.

A transition **into** `paid` enqueues exactly one `fulfill` job and separate customer/owner email jobs (unique `dedupe_key`). Unpaid/expired/failed events do not enqueue those jobs.

Return 2xx after durable commit; 5xx if persistence fails so Stripe retries. Do not call SocialPanel24 or Resend in this handler. Best-effort `process-jobs` kick after commit; Cron is the fallback.

Live provider `add` requires Stripe livemode, `PROVIDER_ENV=live`, `SOCIALPANEL24_ENABLED=true`, and `APP_ENV=production`. Test-mode Stripe is `skipped_test_mode`. A disabled provider **defers** paid live work.

Endpoint: `https://<project>.supabase.co/functions/v1/stripe-webhook`

Prefer a restricted Stripe key (`rk_`) over `sk_`. Pin `Stripe-Version`. Checkout `integration_identifier` is derived from the attempt id + revision (stable under the idempotency key).

Do not commit sandbox claim URLs or webhook secrets. Rotate any URL that was previously committed.

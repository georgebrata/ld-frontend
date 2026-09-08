# Checkout

Flow: platform → service → required details + quantity → review → Stripe Checkout → `/success/`.

## Capability token

1. Browser generates a UUID `checkoutAttemptId` and 32 random bytes (`js/checkout/capability.js`).
2. Token stays in `sessionStorage` across Stripe redirects and retries.
3. Sent in `X-Checkout-Token` and JSON body — never query strings.
4. Server stores SHA-256 hex (`capability_token_hash`). Status and attempt reuse require the same token.

Missing/wrong tokens return the same 404 as an unknown order.

## create-checkout

Body: `serviceId`, `quantity`, supported `inputs`, `customerEmail`, `checkoutAttemptId`, `capabilityToken`, optional `expectedQuote` (comparison only).

Server:

1. Rate-limit + 32 KiB body cap.
2. Load joined catalogue; reject disabled services and extra provider fields.
3. Quote from trusted rate unit, markup, currency, FX (`FX_PROVIDER_TO_RETAIL`).
4. If `expectedQuote.amountMinor` differs, return **409** `{ code: "quote_changed", quote }` for explicit review.
5. Freeze snapshot + `provider_payload` (no credentials).
6. Insert order **before** Stripe session. Attempt id is unique; same params reuse an open session; cancel does not mark the Stripe session cancelled — open sessions are expired before replacement.
7. Idempotency key `ld-checkout-{attemptId}-r{revision}`.

Entered values remain in `sessionStorage` after recoverable errors and `/cancel/`. `/cancel/` updates its retry link to `/?platform=…&service=…` from the draft; the capability token stays out of the URL. A 409 `quote_changed` is stored as the reviewed quote so the next submit sends that total. The submit button is single-flight.

## Confirmation

`js/pages/success-page.js` polls `order-status` with bounded backoff. UI states: awaiting confirmation, payment received, processing, completed, failed, expired/cancelled, unknown. Payment success does not imply fulfilment or email delivery.

Entry points: `js/checkout/checkout-form.js`, `supabase/functions/_shared/checkout.js`, `supabase/functions/create-checkout/index.js`.

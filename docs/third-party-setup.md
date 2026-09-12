# Third-party setup

Do this in order. Static hosting can go live before secrets exist; checkout stays disabled until `js/config.js` has the Supabase URL and anon key **and** retail rows have SocialPanel24 ids.

## 1. Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Copy the project URL and **anon** key into `js/config.js` (`SUPABASE_URL`, `SUPABASE_ANON_KEY`).
3. Apply **all** `supabase/migrations/*.sql` files in order (`npx supabase db push` or SQL editor).
4. Confirm Authentication → Policies: operational tables have RLS on and no grants to `anon`/`authenticated`.
5. Edge Functions → set secrets from `supabase/.env.example`. Keep `SOCIALPANEL24_ENABLED=false`, `PROVIDER_ENV=test`, `APP_ENV=development` until go-live.
6. Deploy every function in `supabase/config.toml`.

```bash
npx supabase@2.58.5 functions deploy catalogue --no-verify-jwt
npx supabase@2.58.5 functions deploy create-checkout --no-verify-jwt
npx supabase@2.58.5 functions deploy stripe-webhook --no-verify-jwt
npx supabase@2.58.5 functions deploy order-status --no-verify-jwt
npx supabase@2.58.5 functions deploy process-jobs --no-verify-jwt
npx supabase@2.58.5 functions deploy refresh-catalogue --no-verify-jwt
npx supabase@2.58.5 functions deploy health --no-verify-jwt
npx supabase@2.58.5 functions deploy operator --no-verify-jwt
npx supabase@2.58.5 functions deploy resend-webhook --no-verify-jwt
npx supabase@2.58.5 functions deploy admin --no-verify-jwt
```

Generate `WORKER_SECRET` with a long random string (not the anon key).

## 2. Stripe

1. Test mode first. Prefer a **restricted** key (`rk_test_…`) over `sk_test_…`.
2. Developers → Webhooks → `https://<project>.supabase.co/functions/v1/stripe-webhook`.
3. Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `payment_intent.payment_failed`.
4. `STRIPE_WEBHOOK_SECRET` = `whsec_…`. Pin `Stripe-Version` (`2026-07-29.dahlia` in code).
5. Success URL is set by the server; do not trust client return URLs.
6. Go live only after switching keys, webhook, `PROVIDER_ENV=live`, `APP_ENV=production`, and an explicit enable of SocialPanel24.

Do not commit sandbox claim URLs.

## 3. Resend

1. Create an account at [resend.com](https://resend.com).
2. Verify the sending domain (SPF/DKIM/DMARC). Until `like-dealer.com` DNS is verified, sending may stay on `orders@solon.agency`.
3. `RESEND_API_KEY`, `FROM_EMAIL`, `FROM_NAME`, `REPLY_TO_EMAIL`, `OWNER_EMAIL`, `SUPPORT_EMAIL`.
4. Add a Resend webhook to `…/functions/v1/resend-webhook` and store `RESEND_WEBHOOK_SECRET`. UI “accepted” is not delivery.

## 4. SocialPanel24

1. Log in at socialpanel24.com → API key. There is no in-repo sandbox.
2. Never put the key in frontend files.
3. Map storefront rows via `socialpanelId` / `RETAIL_SOCIALPANEL_IDS`.
4. Keep `SOCIALPANEL24_ENABLED=false` until Stripe is live **and** you intend live `add` calls. Test Stripe cannot reach the live endpoint.
5. Provider disablement **defers** paid live work; it does not mark fulfilment skipped.

## 5. Static site

1. `npm run build`
2. Upload **`dist/` only** (HTML, `css/`, `js/`, `assets/`, `favicon/`, `legal/`, `sitemap.xml`, `robots.txt`, `_headers`).
3. Production domain must match `SITE_URL` and CORS allowlist (`https://like-dealer.com`).

## 6. Smoke (test mode)

1. Map one service, pay with Stripe test card `4242…`.
2. Confirm fulfilment stays `skipped_test_mode` (no SocialPanel24 `add`).
3. Confirm Resend acceptance (delivery requires DNS + webhook).
4. Cancel path: abandon Checkout, return to `/cancel/`, retry without losing fields.

## Blockers until you finish this list

- Empty `socialpanelId` → nothing is purchasable.
- Missing `STRIPE_SECRET_KEY` → checkout returns 503 after a service is mapped.
- `SOCIALPANEL24_ENABLED=true` with test Stripe is still blocked in code; live Stripe in non-production **defers**.
- Missing `RESEND_API_KEY` and unverified DNS → receipts stay queued/fail.
- Empty `SUPABASE_*` in `js/config.js` → “Checkout is not configured”.
- No webhook secret → Stripe events are rejected.
- Uploading the git tree instead of `dist/` exposes tests and historical Worker code.

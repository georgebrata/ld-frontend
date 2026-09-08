# Third-party setup

Do this in order. Static hosting can go live before secrets exist; checkout stays disabled until `js/config.js` has the Supabase URL and anon key **and** retail rows have SocialPanel24 ids.

## 1. Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Copy the project URL and **anon** key into `js/config.js` (`SUPABASE_URL`, `SUPABASE_ANON_KEY`).
3. In the SQL editor (or `npx supabase db push`), run `supabase/migrations/20260908000001_init.sql`.
4. Confirm Authentication → Policies: `orders`, `jobs`, `stripe_events` have RLS on and no grants to `anon`/`authenticated`.
5. Edge Functions → set secrets from `supabase/.env.example` (`supabase secrets set KEY=value` for each). The live project also accepts the same keys in `public.app_secrets` (RLS on; no browser grants). Non-empty `Deno.env` still wins.
6. Deploy:

```bash
npx supabase functions deploy catalogue --no-verify-jwt
npx supabase functions deploy create-checkout --no-verify-jwt
npx supabase functions deploy stripe-webhook --no-verify-jwt
npx supabase functions deploy order-status --no-verify-jwt
npx supabase functions deploy process-jobs --no-verify-jwt
```

Project `xvrvxofujpqavgnprpmq` already has these five functions deployed with `verify_jwt = false`.
7. Worker: `public.kick_process_jobs()` posts to `process-jobs` every minute via pg_cron when that extension is enabled. You can also Integrations → Cron: every minute `POST /functions/v1/process-jobs` with header `Authorization: Bearer <WORKER_SECRET>`.

Generate `WORKER_SECRET` with a long random string (not the anon key).

## 2. Stripe

1. Test mode first. Create a product-less Checkout integration (the API creates price_data).
2. `STRIPE_SECRET_KEY` = `sk_test_…`.
3. Developers → Webhooks → add `https://<project>.supabase.co/functions/v1/stripe-webhook`.
   The LD sandbox already has this URL (test mode).
4. Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `payment_intent.payment_failed`.
5. `STRIPE_WEBHOOK_SECRET` = `whsec_…` from that endpoint.
6. Success URL is set by the server; do not trust client return URLs.
7. Go live only after switching keys, webhook, and `PROVIDER_ENV`.

## 3. Resend

1. Create an account at [resend.com](https://resend.com).
2. Verify the sending domain (SPF/DKIM). `like-dealer.com` is created in Resend (`eu-west-1`); add the DNS records, then verify.
3. `RESEND_API_KEY`, `FROM_EMAIL` on that domain, `FROM_NAME`, `REPLY_TO_EMAIL`, `OWNER_EMAIL`, `SUPPORT_EMAIL`.
4. Send a test with their test address if needed. Customer mail is a receipt, not a list subscribe.

## 4. SocialPanel24

1. Log in at socialpanel24.com → account page → API key.
2. `SOCIALPANEL24_API_KEY`. Never put it in frontend files.
3. `GET`/`POST` `action=services` (via `node scripts/map-socialpanel24.mjs` with `SOCIALPANEL24_API_KEY`, or the `balance`/`services` adapter) and copy each storefront row’s provider `service` id into `socialpanelId` in `supabase/functions/_shared/retail-catalogue.js`, or set `RETAIL_SOCIALPANEL_IDS` JSON in `app_secrets` (`{"01":"123",…}`).
4. Confirm `type` is one of the enabled handlers. Set `rateUnit` / markup / currency / `FX_PROVIDER_TO_RETAIL` explicitly. Do not assume per-1,000 USD.
5. `PROVIDER_CURRENCY` from `action=balance`. If it differs from `RETAIL_CURRENCY`, set a real FX rate.
6. Keep `PROVIDER_ENV=test` until Stripe is live **and** you intend live `add` calls. Test Stripe + live provider is blocked in code.
7. `SOCIALPANEL24_ENABLED=true` when ready.

## 5. Static site

1. `npm run build`
2. Upload the repo (HTML, `css/`, `js/`, `assets/`, `favicon/`, `sitemap.xml`, `robots.txt`) to any static host / FTP. No application routing middleware.
3. Production domain must match `SITE_URL` and CORS allowlist (`https://like-dealer.com`). Local `localhost` / `127.0.0.1` storefronts send that `Origin`; Checkout success/cancel follow it so the capability token stays in that tab’s `sessionStorage`.
4. Confirm sitemap `<loc>` values use that origin with trailing slashes.

## 6. Smoke (test mode)

1. Map one service, pay with Stripe test card `4242…`.
2. Close the browser on the Stripe page after paying — Cron should still fulfill.
3. Confirm Resend (or Resend dashboard) and a SocialPanel24 order id on the row.
4. Cancel path: abandon Checkout, return to `/cancel/`, retry without losing fields.

## Blockers until you finish this list

- Empty `socialpanelId` → nothing is purchasable. The bundled catalogue now has confirmed ids; keep them in sync if the panel list changes.
- Missing `STRIPE_SECRET_KEY` (Deno.env or `app_secrets`) → checkout returns 503 after a service is mapped.
- Missing `SOCIALPANEL24_API_KEY` → catalogue stays unmapped/missing.
- Missing `RESEND_API_KEY` and unverified `like-dealer.com` DNS → receipts stay queued/fail.
- Empty `SUPABASE_*` in `js/config.js` → “Checkout is not configured”.
- No webhook secret → Stripe events are rejected.
- No cron / worker secret → paid orders sit until you POST `process-jobs`.

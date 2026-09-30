# Go-live checklist (operator)

After the catalogue probe fix is deployed and `refresh-catalogue` has run:

## Admin / products

1. In `/admin/`, enable **Instagram Likes** if it should be sold (`visible`).
2. Map **Instagram Saves** to a SocialPanel24 service, or hide it.
3. Confirm **YouTube Subscribers** minimum **5,000** and comment pricing on a real checkout quote.

## Static site

1. `npm run build` and publish **`dist/`** only.
2. Set Edge secrets `SITE_URL` and `CORS_ALLOW_ORIGINS` to your public origin (`https://like-dealer.com` and any preview host).

## Stripe (live)

1. Keep **one** webhook on `https://xvrvxofujpqavgnprpmq.supabase.co/functions/v1/stripe-webhook` with events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `payment_intent.payment_failed`.
2. Put that endpoint’s `whsec_` in `STRIPE_WEBHOOK_SECRET`; disable duplicate webhooks on the same URL.
3. Use a restricted key (`rk_live_…`) as `STRIPE_SECRET_KEY`.
4. Complete Stripe account activation (identity, bank, payment methods).

## Resend

1. Add DNS for `like-dealer.com`: TXT `resend._domainkey`, MX/TXT on `send` (see Resend dashboard).
2. Until verified, keep `FROM_EMAIL=orders@solon.agency`.
3. Keep `RESEND_WEBHOOK_SECRET` aligned with the webhook → `resend-webhook`.

## SocialPanel24

1. API key only in Edge secrets; fund panel balance.
2. For real fulfilment, set **together**: `SOCIALPANEL24_ENABLED=true`, `PROVIDER_ENV=live`, `APP_ENV=production`, live Stripe keys.
3. Test-mode Stripe never calls `add`. Disabled provider **defers** work (does not skip).

## Cron / secrets

1. `WORKER_SECRET` and `APP_FUNCTIONS_URL` must match in Edge secrets and `public.app_secrets`.

## Canary

1. One small live purchase: Stripe amount matches quote, order `paid` on `/admin/orders/`, panel order id present, receipt accepted (delivery via Resend webhook).
2. Success page and email are not fulfilment proof.

## Support & policy

1. `support@like-dealer.com` inbox live before launch.
2. Refunds: manual in Stripe.
3. Do not enable Subscriptions until bounded `posts` billing exists.
4. Enable Supabase leaked-password protection for admin auth.

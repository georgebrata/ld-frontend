# Agent notes — LikeDealer

## Stack

- Static HTML5 / CSS3 / vanilla JS ES modules. No frontend framework, no application server, no mandatory bundler.
- Privileged work lives in Supabase Edge Functions (`supabase/functions/`, JavaScript).
- Guest checkout uses a 32-byte Web Crypto capability token in `sessionStorage`, hashed server-side. Never put it in query strings, analytics, or logs.
- Server secrets: `Deno.env` (preferred) or `public.app_secrets` overlay. Never put them in `js/`.
- Generate storefront HTML into untracked `dist/` only. Do not deploy `supabase/`, `worker/`, `test/`, or `.env`.

## Do

- Keep the dealer intro: coat open/close, desktop vs mobile parallax, Outfit / Passion One, platform gradients.
- Respect `prefers-reduced-motion`.
- Calculate prices only on the server from the joined catalogue. Rate units are per service (`per_1000` | `per_unit` | `package` | `per_comment`).
- Canonical input name for comments is `comments` (`commentsList` is an alias).
- Map SocialPanel24 types through `provider-types.js`. Do not forward arbitrary browser fields.
- Enqueue provider/email work from the Stripe webhook; do not call SocialPanel24 or Resend inside the webhook handler.
- After dispatch intent is saved, ambiguous `add` outcomes become `submission_unknown` and must never automatic-`add` again.
- Permit live provider `add` only when Stripe livemode, `PROVIDER_ENV=live`, `SOCIALPANEL24_ENABLED=true`, and `APP_ENV=production` (or `ALLOW_LIVE_PROVIDER=true`).
- Parse Stripe objects by type. Never store a `pi_` id in `stripe_session_id`.

## Don’t

- Don’t restore jQuery, Velocity, or `unsafe-eval`.
- Don’t put Stripe, Resend, SocialPanel24, worker, or service-role keys in `js/`.
- Don’t treat a return URL, `pending` status, or unknown provider status as payment success or fulfilment completion.
- Don’t enable Subscriptions until bounded `posts` billing exists.
- Don’t copy the PHP sample’s disabled TLS checks or `device=Desktop`.
- Don’t deploy `worker/` (obsolete). Don’t give agents the service role, worker secret, or arbitrary SQL/HTTP.
- Don’t put an LLM in pricing, webhook verification, provider payload construction, or refunds.

## Entry points

| Area | Path |
|------|------|
| Bootstrap | `js/app.js` |
| Scene | `js/ui/scene.js` |
| Stepper | `js/order/one-page.js` |
| Checkout | `js/checkout/checkout-form.js` |
| Products table | `public.products` (normalized storefront rows; `socialpanel_id` is server-only) |
| Catalogue join | `supabase/functions/_shared/catalogue.js` |
| Catalogue refresh | `supabase/functions/refresh-catalogue/index.js` (daily cron → `catalogue_cache`) |
| Checkout | `supabase/functions/_shared/checkout.js` |
| Webhook | `supabase/functions/_shared/webhook.js` |
| Jobs | `supabase/functions/_shared/jobs.js` |
| Provider | `supabase/functions/_shared/socialpanel24.js` |
| Operator | `supabase/functions/_shared/operator.js` |
| Admin catalogue | `supabase/functions/_shared/admin.js` (`/admin/`) |
| Health | `supabase/functions/health/index.js` |
| Contracts | `contracts/` |

## Tests

`npm test` — Node test runner, mocked SocialPanel24/Stripe/Resend. No live provider calls.
`npm run build:check` — offline `dist/` generation.

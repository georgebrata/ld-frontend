# Agent notes — LikeDealer

## Stack

- Static HTML5 / CSS3 / vanilla JS ES modules. No frontend framework, no application server, no mandatory bundler.
- Privileged work lives in Supabase Edge Functions (`supabase/functions/`, JavaScript).
- Guest checkout uses a 32-byte Web Crypto capability token in `sessionStorage`, hashed server-side. Never put it in query strings, analytics, or logs.
- Server secrets: `Deno.env` (preferred) or `public.app_secrets` overlay. Never put them in `js/`.

## Do

- Keep the dealer intro: coat open/close, desktop vs mobile parallax, typed tagline, Outfit / Passion One, platform gradients.
- Respect `prefers-reduced-motion`.
- Calculate prices only on the server from the joined catalogue. Rate units are per service (`per_1000` | `per_unit` | `package` | `per_comment`).
- Canonical input name for comments is `comments` (`commentsList` is an alias).
- Map SocialPanel24 types through `provider-types.js`. Do not forward arbitrary browser fields.
- Enqueue provider/email work from the Stripe webhook; do not call SocialPanel24 or Resend inside the webhook handler.
- After dispatch intent is saved, ambiguous `add` outcomes become `submission_unknown` and must never automatic-`add` again.

## Don’t

- Don’t restore jQuery, Velocity, or `unsafe-eval`.
- Don’t put Stripe, Resend, SocialPanel24, worker, or service-role keys in `js/`.
- Don’t treat a return URL, `pending` status, or unknown provider status as payment success or fulfilment completion.
- Don’t enable Subscriptions until bounded `posts` billing exists.
- Don’t copy the PHP sample’s disabled TLS checks or `device=Desktop`.

## Entry points

| Area | Path |
|------|------|
| Bootstrap | `js/app.js` |
| Scene | `js/ui/scene.js` |
| Stepper | `js/order/one-page.js` |
| Checkout | `js/checkout/checkout-form.js` |
| Catalogue join | `supabase/functions/_shared/catalogue.js` |
| Checkout | `supabase/functions/_shared/checkout.js` |
| Webhook | `supabase/functions/_shared/webhook.js` |
| Jobs | `supabase/functions/_shared/jobs.js` |
| Provider | `supabase/functions/_shared/socialpanel24.js` |

## Tests

`npm test` — Node test runner, mocked SocialPanel24/Stripe/Resend. No live provider calls.

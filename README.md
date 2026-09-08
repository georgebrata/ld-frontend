# LikeDealer

Static HTML / CSS / vanilla JavaScript storefront for guest social-media engagement purchases. One service per order. Stripe Checkout is created server-side. Paid orders are submitted to SocialPanel24 by a scheduled Edge Function — the customer’s browser is not required after payment.

```
Static pages (HTML / CSS / ES modules)
        │
        ├── GET catalogue          → Edge Function `catalogue`
        ├── POST create-checkout   → Edge Function `create-checkout`
        └── POST order-status      → Edge Function `order-status` + capability token
                    │
                    ▼
              Supabase
         (private orders / jobs)
                    │
         ┌──────────┼──────────┐
         ▼          ▼          ▼
    Stripe      SocialPanel24  Resend
    webhooks    process-jobs   (payment emails)
```

The browser never receives Stripe secrets, SocialPanel24 keys or IDs, Resend keys, or the service role key. A public anon key is not purchaser authorization.

## One-page order flow

1. Dealer hero (coat / parallax / typed intro).
2. Choose a platform.
3. Choose a service.
4. Enter email and only the fields that service needs (never a password).
5. Review quantity limits, total/currency, target, and refund facts.
6. Pay on Stripe-hosted Checkout.
7. Confirmation polls `order-status` with the capability token. Fulfilment continues if the tab is closed.

`prefers-reduced-motion: reduce` skips entrance, parallax, coat tween, card wiggle, typed loop, and auto-scroll. The opened coat and `#page` are shown immediately. The typed intro exposes a stable tagline to assistive technology.

## Local development

Node 18+.

```bash
npm install
npm test
npm run build
python3 -m http.server 3000
```

ES modules need an HTTP server — do not open HTML via `file://`.

Supabase functions (separate terminal, after `supabase start` or a hosted project):

```bash
cp supabase/.env.example supabase/.env
# fill secrets — never commit them
npx supabase functions serve --no-verify-jwt
```

Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` in [`js/config.js`](js/config.js).

## Frontend configuration

Edit [`js/config.js`](js/config.js). Secrets do not belong here.

| Key | Description |
|-----|-------------|
| `SITE_URL` | Canonical origin (`https://like-dealer.com`) |
| `SUPABASE_URL` | Project URL |
| `SUPABASE_ANON_KEY` | Public anon key (not authorization) |
| `SUPABASE_FUNCTIONS_URL` | Optional override, e.g. local `http://127.0.0.1:54321/functions/v1` |
| `ORDER_ID_PREFIX` | Display prefix (`LD-`) |
| `ANALYTICS_ENABLED` | Optional events; requires `localStorage ld.analyticsConsent=1` |

Obsolete Apps Script, n8n, Cloudflare Worker, and MailerSend settings have been removed.

## Edge Functions

Guest functions use `verify_jwt = false` and their own validation. `process-jobs` requires `WORKER_SECRET`.

| Function | Auth | Purpose |
|----------|------|---------|
| `catalogue` | CORS + rate limit | Public services only |
| `create-checkout` | capability token + rate limit | Validate, quote, persist, Stripe session |
| `stripe-webhook` | Stripe signature | Payment transitions + jobs |
| `order-status` | capability token hash | Minimal authorized summary |
| `process-jobs` | `WORKER_SECRET` | Provider submit/poll + Resend |

See [docs/supabase.md](docs/supabase.md), [docs/stripe.md](docs/stripe.md), [docs/socialpanel24.md](docs/socialpanel24.md), [docs/fulfillment.md](docs/fulfillment.md), [docs/emails.md](docs/emails.md).

Third-party provisioning: [docs/third-party-setup.md](docs/third-party-setup.md).

## Existing orders

Apps Script sheets and Cloudflare Worker KV orders are **not** imported. Do not delete those stores until you have exported anything you still need. New checkouts write only to Postgres `orders` / `jobs` / `stripe_events`.

## Pages

| URL | Purpose |
|-----|---------|
| `/` | Homepage stepper |
| `/{platform}/` | Same stepper, platform preselected |
| `/{platform}/{slug}/` | Service preselected |
| `/why/` | Why LikeDealer |
| `/success/` | Status (noindex). Arrival is not proof of payment. |
| `/cancel/` | Abandoned Checkout (noindex); details stay in sessionStorage |
| `/404.html` | Not found |

## Commands

```bash
npm test          # 40 Node tests (pricing, comments, webhook, jobs, tokens)
npm run build     # static pages + sitemap from the retail catalogue
```

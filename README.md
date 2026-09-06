# LikeDealer

Static HTML / CSS / vanilla JavaScript storefront for anonymous social-media engagement purchases. The homepage is a single stepped form: pick a platform, pick a service, then pay with Stripe. A Cloudflare Worker is the only price and payment authority.

```
Static frontend (HTML / CSS / ES modules)
        │
        ├── GET Services sheet  → Google Apps Script
        │
        └── Checkout / quote / order lookup
                    │
                    ▼
            Cloudflare Worker
         ┌──────────┼──────────┐
         ▼          ▼          ▼
    Stripe      SocialPanel24  MailerSend
    Checkout    (×2 markup)    (transactional)
                    │
                    ▼
            Orders sheet (compatible fields)
            + Worker KV (lifecycle source of truth)
```

The browser never receives Stripe secrets, SocialPanel24 keys or IDs, or MailerSend tokens. It never POSTs to the Orders sheet.

## One-page order flow

1. Dealer hero (coat / parallax / typed intro).
2. Choose a platform — services expand beneath and the page scrolls.
3. Choose a service — the checkout form expands beneath.
4. Enter details and continue — the only leave is Stripe Checkout.

SEO routes `/{platform}/` and `/{platform}/{slug}/` mount the same stepper with that platform or service preselected. Homepage share URLs use `/?platform=instagram&service=likes`.

`prefers-reduced-motion: reduce` skips entrance, parallax, coat tween, card wiggle, typed loop, and auto-scroll. The opened coat and `#page` are shown immediately.

## Local development

Node 18+ is required.

```bash
npm install
npm test
npm run build
npm run dev
```

`npm run dev` builds the static pages and serves them (usually `http://localhost:3000`). ES modules need a local server — do not open HTML via `file://`.

Worker (separate terminal):

```bash
cp worker/.dev.vars.example worker/.dev.vars
# fill secrets locally — never commit .dev.vars
npm run worker:dev
```

Then set `CHECKOUT_WORKER_URL` in [`js/config.js`](js/config.js) to the Wrangler origin (typically `http://127.0.0.1:8787`) for local checkout.

## Frontend configuration

Edit [`js/config.js`](js/config.js). Secrets do not belong here.

| Key | Description |
|-----|-------------|
| `API_BASE_URL` | Google Apps Script web app (Services sheet) |
| `CHECKOUT_WORKER_URL` | Worker origin, e.g. `https://api.like-dealer.com`. Empty shows “Checkout is not configured”. |
| `SITE_URL` | Canonical site origin |
| `ORDER_ID_PREFIX` | Display prefix (`LD-`) |
| `DEFAULT_QUANTITY` | Default quantity (1000) |

## Worker routes

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/checkout/session` | Validate, price, create pending order, Stripe session |
| `POST` | `/api/checkout/quote` | Live total for the form (not the charge source of truth) |
| `GET` | `/api/catalog/:serviceId` | Inputs, qty min/max, marked-up unit price. No `socialpanelId`. |
| `POST` | `/api/webhooks/stripe` | Signed Stripe events → pay / fulfil / email |
| `GET` | `/api/orders/:id` | Customer-safe lookup by internal id or `cs_…` session id |
| `GET` | `/api/health` | Liveness |

CORS allowlist is `SITE_URL` plus localhost for `wrangler dev`.

### Checkout session body

```json
{
  "serviceId": "01",
  "quantity": 1000,
  "customerEmail": "customer@example.com",
  "inputs": { "url": "https://instagram.com/p/example" }
}
```

No client price. No `socialpanelId`. Known input keys: `url`, `username`, `commentsList`.

Response: `{ "checkoutUrl": "https://checkout.stripe.com/...", "orderId": "…" }`.

Stripe redirects:

- Success: `{SITE_URL}/success/?session_id={CHECKOUT_SESSION_ID}`
- Cancel: `{SITE_URL}/cancel/`

### Pricing

The Worker fetches SocialPanel24 `action=services`, finds the sheet `socialpanelId`, reads `rate` (USD per 1,000), applies **×2 markup**, and charges integer cents only. Sheet `Price` is display-only. Missing id or rate → not purchasable.

```javascript
const rateCentsPer1000 = Math.round(Number(rate) * 100);
const markedUp = rateCentsPer1000 * 2;
const totalInCents = Math.round((markedUp * quantity) / 1000);
```

Quantity must also satisfy SocialPanel24 `min` / `max`.

### Orders

KV is the lifecycle source of truth. The Worker also appends/updates the Orders sheet.

Create payload (compatible fields):

```json
{
  "action": "append",
  "data": {
    "CustomerEmail": "email@customer.com",
    "Service": "Instagram Likes",
    "ServiceId": "01",
    "URL": "https://instagram.com/p/...",
    "Notes": "",
    "Quantity": 1000,
    "Status": "pending"
  }
}
```

`inputs.url` or `inputs.username` → `URL`. Extra inputs (comments) → `Notes`.

Optional columns if Apps Script stores extra keys: `StripeSessionId`, `StripePaymentIntentId`, `SocialPanelOrderId`, `StripeEventId`, `CustomerEmailStatus`, `OwnerEmailStatus`.

States: `pending` → `payment_pending` → `paid` → `processing` → `completed`. Failures: `payment_failed`, `fulfilment_failed`, `cancelled`.

Email statuses (`pending` / `sent` / `failed`) are independent. A MailerSend failure must not revert `paid`.

Idempotency: KV `stripe:event:{eventId}` and `order:{id}.socialPanelOrderId`. One successful payment = one SocialPanel24 `add`. If `add` may have succeeded but the response was lost, the order is `fulfilment_failed` and is **not** added again.

### SocialPanel24

`POST https://socialpanel24.com/api/v2` as form `key` + `action`.

Implemented: `services`, `add`, `status`. Stub-ready: refill, cancel, balance, multi-status.

Mappers:

- default: `service` + `link` + `quantity`
- `commentsList`: `service` + `link` + `comments`
- username-only: username becomes a profile URL in `link`
- unknown client keys: ignored

### MailerSend

Transactional only. Buyers are not added to marketing lists.

- Customer: `LikeDealer — Order #LD-XXXXXX confirmed`
- Owner: `LikeDealer — New paid order #LD-XXXXXX`

Verify the sending domain in MailerSend before production.

## Wrangler secrets and vars

From [`worker/wrangler.toml`](worker/wrangler.toml):

```bash
cd worker
npx wrangler kv namespace create ORDERS
# put the id into wrangler.toml — do not invent one
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET
npx wrangler secret put SOCIAL_PANEL_API_KEY
npx wrangler secret put MAILERSEND_API_TOKEN
npx wrangler secret put OWNER_EMAIL
npx wrangler secret put FROM_EMAIL
npx wrangler deploy
```

Vars (safe to commit): `SITE_URL`, `MARKUP_MULTIPLIER=2`, `SOCIAL_PANEL_API_URL`, `ORDERS_API_URL`, `FROM_NAME`.

Stripe webhook URL: `https://<worker-host>/api/webhooks/stripe`.

Create a KV namespace and replace `REPLACE_WITH_KV_NAMESPACE_ID` in `wrangler.toml` before deploy.

## Pages

| URL | Purpose |
|-----|---------|
| `/` | Homepage stepper |
| `/{platform}/` | Same stepper, platform preselected |
| `/{platform}/{slug}/` | Same stepper, service preselected + JSON-LD when a display price exists |
| `/why/` | Why LikeDealer |
| `/success/` | Payment received (noindex). Never claims fulfilment is complete. |
| `/cancel/` | Payment cancelled (noindex) |
| `/404.html` | Not found |

## Module map

| Module | Responsibility |
|--------|----------------|
| `js/app.js` | Page bootstrap |
| `js/order/one-page.js` | Platform → service → checkout stepper |
| `js/checkout/checkout-form.js` | Inline checkout, Worker quote/session |
| `js/checkout/input-renderer.js` | `INPUT_REGISTRY` fields |
| `js/api/services-api.js` | Visible services (`#services-data` then live API) |
| `js/api/orders-api.js` | Worker catalog / quote / session / public order |
| `js/ui/scene.js` | Dealer entrance, coat, `#page` reveal, rAF parallax, menu |
| `plugins/plugins.js` | Velocity.js only |
| `scripts/build.mjs` | Fetch services and generate static pages |
| `worker/src/` | Stripe, pricing, fulfilment, email, KV |

## Deployment

1. `npm run build` so FTP/static hosting serves generated `index.html`, platform/service pages, and `sitemap.xml`.
2. Deploy the Worker with Wrangler and set `CHECKOUT_WORKER_URL` to that origin.
3. Point Stripe’s webhook at `/api/webhooks/stripe`.
4. Production static deploy remains GitHub Actions FTP to `like-dealer.com` on push to `main`.

## Manual QA checklist

- Keyboard: platform and service cards are arrow-selectable; Enter confirms; checkout fields have visible labels; skip-link reaches the form.
- `prefers-reduced-motion: reduce`: no entrance / parallax / coat tween / auto-scroll; `#page` visible.
- Viewports: 320, 375, 768, 1024, 1440, 1920.
- Stripe test mode: success lands on `/success/` without claiming fulfilment is complete; cancel lands on `/cancel/` and is not paid.
- Catalogue error and empty states: retry works; invisible services never render.
- Checkout with empty `CHECKOUT_WORKER_URL` shows a configuration message, not an alert.

## Troubleshooting

| Symptom | Check |
|---------|--------|
| “Checkout is not configured” | `CHECKOUT_WORKER_URL` in `js/config.js` |
| Service not purchasable | Sheet `socialpanelId` + SocialPanel24 `rate` / min / max |
| Webhook 400 | Raw body + `STRIPE_WEBHOOK_SECRET`; do not parse JSON before verify |
| Paid but not processing | `fulfilment_failed` / unknown prior `add` — reconcile manually, do not re-add blindly |
| No email | MailerSend domain verify + `MAILERSEND_API_TOKEN` / `FROM_EMAIL`; payment status stays paid |
| CORS errors | Request origin must be `SITE_URL` or localhost |

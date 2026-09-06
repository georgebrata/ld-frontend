# Like Dealer

Static social-media engagement marketplace built with HTML, CSS, and vanilla JavaScript.

## Architecture

```
Static Frontend (HTML / CSS / JS)
        │
        ├── GET Services  → Google Apps Script
        │
        └── POST Orders   → Google Apps Script
                    │
                    ▼
              n8n Backend
                    │
         ┌──────────┴──────────┐
         ▼                     ▼
    Stripe Checkout      MailerLite Email
```

The frontend never contains Stripe secrets, MailerLite credentials, or webhook keys.

## Local Development

Node 18+ is required for the static page build.

```bash
npm run build
npx serve .
```

Or `npm run dev` to build and serve. Open `http://localhost:3000` (or the port shown). ES modules require a local server — do not open HTML files directly via `file://`.

`npm run build` fetches the Services sheet, writes `data/services.json`, and generates:

- `/` — platform cards already in the HTML
- `/{platform}/` — service cards as links
- `/{platform}/{service-slug}/` — one page per service
- `sitemap.xml`

Run the build before deploying so the FTP host serves complete pages.

## Configuration

Edit [`js/config.js`](js/config.js):

| Key | Description |
|-----|-------------|
| `API_BASE` | Google Apps Script web app URL |
| `N8N_CHECKOUT_URL` | n8n webhook for Stripe checkout session (empty = pending-order fallback) |
| `ORDER_ID_PREFIX` | Display prefix for order references (`LD-`) |
| `DEFAULT_QUANTITY` | Default checkout quantity (1000) |

## Module Map

| Module | Responsibility |
|--------|----------------|
| `js/app.js` | Page bootstrapping |
| `js/api/services-api.js` | Fetch & normalize services (uses `#services-data` snapshot first) |
| `js/api/orders-api.js` | Create & fetch orders |
| `js/catalogue/render-home.js` | Homepage platform cards |
| `js/catalogue/render-services.js` | Platform service cards |
| `js/pages/service-page.js` | Dedicated service page checkout |
| `js/checkout/checkout-modal.js` | Accessible checkout modal |
| `js/checkout/input-renderer.js` | Dynamic form fields |
| `js/confirmation/confirmation-page.js` | Post-payment confirmation |
| `js/ui/scene.js` | Menu, parallax, coat swap |
| `plugins/plugins.js` | Velocity.js |
| `scripts/build.mjs` | Fetch services and generate static pages |

## Services API

```
GET {API_BASE}?sheet=Services
```

Returns `{ ok, data: [{ ID, Visible, Platform, Service, Description, Price, Inputs, ... }] }`.

- Services with `Visible: FALSE` are filtered out at the data layer.
- `Inputs` is comma-separated (e.g. `url, commentsList`).

## Orders API

Create:

```
POST {API_BASE}?sheet=Orders
Content-Type: application/json

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

Fetch:

```
GET {API_BASE}?sheet=Orders&id={orderId}
```

## n8n Checkout Contract

When `N8N_CHECKOUT_URL` is set, the frontend POSTs after creating a pending order:

**Request:**

```json
{
  "orderId": "uuid-from-orders-api",
  "serviceId": "01",
  "service": "Instagram Likes",
  "quantity": 1000,
  "customerEmail": "customer@example.com",
  "url": "https://instagram.com/p/...",
  "notes": ""
}
```

**Response:**

```json
{
  "checkoutUrl": "https://checkout.stripe.com/c/pay/..."
}
```

The frontend redirects to `checkoutUrl`. n8n handles price validation, Stripe session creation, and webhooks.

### Stripe Redirect URLs

Configure n8n / Stripe to redirect to:

- **Success:** `https://like-dealer.com/confirmation.html?orderId={orderId}`
- **Cancel:** `https://like-dealer.com/confirmation.html?orderId={orderId}`

n8n must update order `Status` via webhook before redirect:

| Event | Status |
|-------|--------|
| Payment success | `processing` or `paid` |
| Payment cancelled | `cancelled` |
| Payment failed | `failed` |

The confirmation page reads status from the Orders API — not from URL parameters.

## MailerLite (Server-Side Only)

On successful Stripe payment, n8n sends a transactional email via MailerLite containing:

- Order ID
- Service & quantity
- Submitted URL / notes
- Amount
- Order status
- Support contact

MailerLite API credentials must remain in n8n, never in this frontend.

## Deployment

Production deploys via GitHub Actions FTP to `like-dealer.com` on push to `main`.

## Pages

| URL | Purpose |
|-----|---------|
| `/` | Homepage — platform picker |
| `/{platform}/` | Platform service catalogue |
| `/{platform}/{service-slug}/` | Individual service + checkout |
| `/why/` | Why Like Dealer |
| `/confirmation.html` | Order confirmation |
| `/404.html` | Not found |

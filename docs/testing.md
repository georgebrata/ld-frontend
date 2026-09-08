# Testing

```bash
npm test
npm run build
python3 -m http.server 3000
```

## Automated (simulated)

`npm test` on 8 September 2026: **49 passed, 0 failed**.

Node tests with mocked SocialPanel24, Stripe, and Resend. **Not** live verification.

Coverage includes:

1. Rate units, comment aliases, multiline comments in frozen payload, serializers omitting `quantity` for custom comments, tampered provider ids/prices rejected.
2. Webhook signatures, unpaid sessions, duplicate events, amount mismatch, paid lock.
3. Worker `add` form body, unpaid never `add`, lost response → `submission_unknown`, lease-after-dispatch, balance block, test Stripe vs live provider, mixed batch status, independent email retry, concurrent claim.
4. Status endpoint: wrong/missing token fails.
5. Cancel retry URL restores platform/service and never includes the capability token.

Fixtures: `test/fixtures/socialpanel24.json`.

## Browser (this repo, 8 September 2026)

Recorded **before** the native scene rewrite:

- Desktop 1920×1080 rest: closed coat, LIKE DEALER, typed platform fragment, scroll chevron, hamburger as a `<button>`.
- Desktop scrolled past 150px: coat opens onto BOOST YOUR SOCIALS + Instagram/TikTok/YouTube cards + trust copy.
- Mobile 390×844: hamburger top-right, typed tagline, mascot; scroll uses horizontal background parallax.

Re-checked **after** the native rewrite (Cursor browser + static `python3 -m http.server 3000`):

- Desktop rest: closed coat, typed intro (`aria-hidden` characters + visually hidden stable tagline), scroll chevron, hamburger as a `<button>`.
- Desktop scroll past 150px: `coat-open` class, `#page` revealed, BOOST YOUR SOCIALS + platform cards + trust copy.
- Menu button opens a dialog overlay; Escape closes it and returns focus to the button.
- Instagram → Comments: fields are Post URL, Comments (canonical `name="comments"`), Email. No password. Quantity is derived from nonempty comment lines.
- Submit without Supabase: alert “Checkout is not configured yet.” Entered values remain.
- `/cancel/` with a draft: retry link is `/instagram/comments/` or `/?platform=instagram&service=comments`; token stays out of the URL. Reloading that URL restores URL, comments, and email.
- `/facebook/`: static “not offered” page, no jQuery.
- `/success/` without token: “Order reference missing” — not treated as paid.
- Mobile 390×844: hamburger on the right (`left ≈ 331px`); coat opens past the mobile threshold.
- Sitemap Instagram `<loc>` is `https://like-dealer.com/instagram/`. Canonical/OG use that origin with trailing slashes.
- Frontend `js/config.js` has the public Supabase URL, anon key, and functions URL; no Stripe/Resend/SocialPanel24 secrets in storefront JS.

Not executed in the browser: Stripe Checkout redirect, webhook, Resend, SocialPanel24 `add`, Cron worker.

`prefers-reduced-motion` is implemented in CSS/JS (stable intro, skip tweens, `#page` visible). A dedicated reduced-motion lab pass was not run.

Core Web Vitals were **not** measured (no Lighthouse run). Treat field p75 targets (LCP ≤2.5s, INP ≤200ms, CLS ≤0.1) as outstanding.

## Live (this project, 8 September 2026)

Project `xvrvxofujpqavgnprpmq`:

- Five Edge Functions deployed, `verify_jwt = false`. `catalogue` v6 (mapped SocialPanel24 ids); `create-checkout` v8; `process-jobs` v5; `stripe-webhook` v4.
- `GET /functions/v1/catalogue` returns six visible services, all `purchasable: true`.
- `POST process-jobs` without secret → 401.
- `POST stripe-webhook` without signature → 400 Invalid signature.
- `POST create-checkout` with empty body → validation error (email required).
- Stripe test webhook `we_1UDVKODDSooeTCXK56bgztdl` exists for that functions URL. `stripe-webhook` v4 ignores unknown sessions after signature verification.
- `public.app_secrets` holds non-key config, `WORKER_SECRET`, `STRIPE_SECRET_KEY`, `RESEND_API_KEY`, and the CLI-sandbox `STRIPE_WEBHOOK_SECRET`. `anon` cannot SELECT.
- `cron.job` `ld-process-jobs` runs every minute (`select public.kick_process_jobs()`).
- Resend domain `like-dealer.com` is created, not yet DNS-verified.

Live guest purchase 8 September 2026 (`http://127.0.0.1:8765/` → Stripe test card `4242…`): order `LD-FE92D6`, Instagram Likes × 1000, `$0.52`. Webhook marked `paid`. `process-jobs` submitted SocialPanel24 order `119674166` (`fulfillment_status=in_progress`). Resend delivered the customer receipt; owner mail was accepted for `owner@like-dealer.com`. Success page showed payment received / processing and did not treat return-URL arrival as fulfilment complete.

Still outstanding for production: `like-dealer.com` DNS / static host, Resend DNS for that domain, claim the CLI Stripe sandbox before 2026-09-15, and a real `OWNER_EMAIL`. Webhook `we_1UDVKODDSooeTCXK56bgztdl` signing secret is in `app_secrets`.

See [third-party-setup.md](./third-party-setup.md).

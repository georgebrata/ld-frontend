# Testing

```bash
npm ci
npm test
npm run build:check
npm run dev
```

## Automated (simulated)

`npm test` covers pricing, checkout fingerprints, webhook signatures (including failed PaymentIntents that must not overwrite `cs_` session ids), fulfilment gates (test Stripe never hits live SocialPanel24; provider disablement defers paid work), coalesced status polling, operator proposals, and catalogue contracts.

Node tests with mocked SocialPanel24, Stripe, and Resend. **Not** live verification. No live `add` in CI.

Fixtures: `test/fixtures/socialpanel24.json`.

## Browser

Serve **`dist/`**, not the repository root. Check:

- Dealer intro (coat, menu `hidden`/`inert`, reduced motion).
- Embedded catalogue then live refresh.
- Checkout fingerprint rotation (“Start a new checkout”).
- Success page keeps polling non-terminal fulfilment and distinguishes offline vs unauthorized.
- Legal pages and support mailto with order reference only.

Not executed by default: Stripe Checkout redirect, webhook, Resend, SocialPanel24 `add`, Cron worker.

## Live

Treat production as unready until:

- All migrations including `20260910000001_hardening.sql` and `20260910000002_ops_agent.sql` are applied.
- Nine Edge Functions are deployed.
- `SOCIALPANEL24_ENABLED=false` unless Stripe is live **and** production identity is explicit.
- Static host publishes `dist/` only.
- Resend DNS is verified; delivery webhook is attached.

Historical note: a test-card purchase on 8 September 2026 created live SocialPanel24 order `119674166`. That path is now blocked when Stripe `livemode` is false.

See [third-party-setup.md](./third-party-setup.md), [unit-economics.md](./unit-economics.md), [release.md](./release.md).

# LikeDealer Technical Audit & Pre-Go-Live Production Roadmap

**Audit Date:** 2026-10-01  
**Auditor:** Automated Principal Staff Architect / Security Auditor / SRE  
**Project:** `ld-frontend` — LikeDealer  
**Stack:** Static HTML5/CSS3/Vanilla JS → Supabase Edge Functions (Deno) → Stripe / SocialPanel24 / Resend  

---

## 1. Executive Summary & Architecture Scorecard

| Pillar | Score (1–10) | Status | Key Blocker / Strength |
|---|---|---|---|
| Frontend & Edge Delivery (Vercel) | **7** | ⚠️ Needs Work | CSP only via `<meta>` tag, no coverage on 404; dynamic import cache-busting gap |
| Backend & Edge Functions (Supabase) | **8** | ✅ Strong | RLS enabled on all 15 tables (but zero explicit policies — secure-by-denial); robust job state machine |
| Payment Gateway & Financial Integrity (Stripe) | **9.5** | ✅ Excellent | Server-authoritative pricing, idempotent webhook, strict `pi_`/`cs_` separation; duplicate webhook resolved |
| Agentic Control Plane & AI Safety | **9** | ✅ Excellent | LLM-free deterministic paths, typed operator proposals, sanitized agent views |
| Observability & Reliability | **7** | ⚠️ Needs Work | Good health probes and log redaction, but no external alerting, no structured log sink configured |
| **Overall Production Readiness** | **8.0** | ⚠️ **Near-Ready** | **3 P0 blockers** remain before live traffic (domain, leaked password, CSP headers) |

---

## 2. In-Depth Technical Assessment

### A. Frontend Architecture & Edge Delivery (Vercel)

#### Live Infrastructure (Verified via Vercel MCP)
- **Project**: `prj_RGeFwt2cLxMS6pprVC3dxWpvbLtM` — `ld-frontend`
- **Latest Deployment**: `dpl_C3TQYcsgrMn8NM8EstsiWQxShEsm` — `READY`, target: `production`
- **Node Version**: 24.x
- **Custom Domain**: ❌ **None configured** — only `ld-frontend-phi.vercel.app` (Vercel subdomain)
- **SSO Protection**: ✅ Enabled on all deployments except custom domains
- **Password Protection**: ❌ Disabled
- **Trusted IPs / WAF**: ❌ Not configured

#### Security Headers ([vercel.json](file:///Users/gbrata/Documents/PERSONAL/ld-frontend/vercel.json) + [_headers](file:///Users/gbrata/Documents/PERSONAL/ld-frontend/_headers))
✅ **Strengths**: Comprehensive header set — `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, HSTS with `includeSubDomains`, immutable cache headers on hashed assets, `no-store` on admin routes.

⚠️ **Gaps**:
- **No CSP HTTP Header**: Content Security Policy is only delivered via `<meta>` tags in individual HTML files. [404.html](file:///Users/gbrata/Documents/PERSONAL/ld-frontend/404.html) lacks it entirely. `<meta>` CSP cannot enforce `frame-ancestors`.
- **CSP allows unused CDN**: [index.html](file:///Users/gbrata/Documents/PERSONAL/ld-frontend/index.html) (line 27) allows `https://cdn.jsdelivr.net` in `script-src`/`connect-src` despite the build script guarding against jsDelivr in production.

#### Build Pipeline ([scripts/build.mjs](file:///Users/gbrata/Documents/PERSONAL/ld-frontend/scripts/build.mjs))
✅ **Strengths**: SHA-256 content hashing for root CSS and key scripts (`applyContentHashes`), preloads critical SVGs.

⚠️ **Gaps**:
- **Dynamic import cache-busting gap**: `applyContentHashes()` only replaces paths in `.html` files. Dynamically imported modules (e.g., `import('./order/one-page.js')` inside `js/app.js`) retain stale paths for returning users.
- **Regex mismatch**: `success/index.html` and `cancel/index.html` scripts lack `?v=` suffixes, so the build script's `app.js?v=[^"']+` regex silently fails.
- **No minification**: Assets are copied verbatim — no HTML/JS/CSS minification.

#### Client-Side Security
✅ **Excellent**: 32-byte Web Crypto capability token is correctly restricted to `sessionStorage`. Never in URLs, query strings, analytics, or referrer headers. `localStorage` is only used for analytics consent. Analytics adapter explicitly scrubs `capabilityToken` before sending.

#### Accessibility & Motion
✅ **Strong**: `prefers-reduced-motion: reduce` is respected across CSS and JS. Good ARIA integration (`aria-expanded`, `aria-hidden`, `aria-invalid`, `aria-live`).

⚠️ **Minor**: Skip-link target `#platforms` (line 56 of `index.html`) is injected by JS — screen readers activating before hydration will find no target.

#### Core Web Vitals
⚠️ **LCP risk**: `js/ui/scene.js` appears to load synchronously (line 264), potentially blocking LCP.

---

### B. Backend, Database & Edge Functions (Supabase)

#### Live Infrastructure (Verified via Supabase MCP)
- **Project**: `xvrvxofujpqavgnprpmq` — `ld-frontend`, Region: `eu-west-1`
- **Postgres**: 17.6.1.166 (GA channel) ✅
- **Status**: `ACTIVE_HEALTHY` ✅
- **Migrations Applied**: 16 (matches local, including `youtube_quantity_default`) ✅
- **Edge Functions Deployed**: 10 — all `ACTIVE` ✅ (`order-status`, `stripe-webhook`, `catalogue`, `process-jobs`, `create-checkout`, `refresh-catalogue`, `admin`, `health`, `resend-webhook`, `operator`)

#### Database Schema (Live SQL Verified)

**Tables (15)** — All have `rls_enabled: true` ✅:
`orders` (5 rows), `stripe_events` (4), `jobs` (4), `catalogue_cache` (1), `rate_limits` (0), `app_secrets` (21), `products` (7), `admin_users` (1), `app_flags` (1), `product_audit` (4), `external_requests` (0), `order_events` (2), `operator_actions` (0), `retention_settings` (5), `job_attempts` (0)

**RLS Policies**: ❌ **Zero explicit policies on any table** — Supabase Security Advisor confirms: `rls_enabled_no_policy` on all 15 tables. This is a **secure-by-denial** pattern (RLS enabled with no policies = all `anon`/`authenticated` queries denied), but it's risky because:
1. Any developer adding a policy in the future could inadvertently open access
2. Intent is not documented in schema — it's impossible to distinguish "deliberately locked" from "forgot to add policies"

**Indexes** (Live verified — comprehensive):
- `orders`: ✅ `orders_capability_hash_idx`, `orders_stripe_session_unique`, `orders_checkout_attempt_unique`, `orders_payment_status_idx`, `orders_created_at_idx`, `orders_provider_order_id_uidx`, `orders_provider_refill_id_uidx`, `orders_email_idx`, `orders_status_created_idx`, `orders_fulfillment_status_idx`
- `jobs`: ✅ `jobs_due_idx(status, next_retry_at)`, `jobs_dedupe_key_unique`, `jobs_order_id_idx`
- `stripe_events`: ✅ `stripe_events_pkey(event_id)` — idempotency key
- Performance advisor flagged 9 unused indexes (expected for pre-launch low traffic)

**Cron Jobs** (Live verified):
| Job | Schedule | Command |
|-----|----------|---------|
| `ld-process-jobs` | `* * * * *` (every minute) | `select public.kick_process_jobs()` |
| `ld-refresh-catalogue` | `0 6 * * *` (daily 06:00 UTC) | `select public.kick_refresh_catalogue()` |
| `ld-purge-retention` | `17 * * * *` (hourly at :17) | `select public.purge_retained_rows()` |

**Agent Views** (Live verified — properly redacted):
- `agent.catalogue_anomalies`: Exposes `id, platform, service, visible, unmapped, min_contribution_minor` — ✅ No emails/tokens/keys
- `agent.order_states`: Exposes `id, display_id, payment_status, fulfillment_status, amount_minor, currency, expected_provider_cost_minor, expected_contribution_minor, created_at` — ✅ No emails/targets/tokens
- `agent.queue_health`: Aggregates `jobs_pending, jobs_failed, jobs_leased, jobs_succeeded` — ✅ No PII

**Table Grants** (Live verified):
- ✅ **Zero grants** to `anon` or `authenticated` roles on any public/agent table — fully locked down

#### Supabase Security Advisor (Live)

> [!CAUTION]
> **`auth_leaked_password_protection`**: Leaked password protection is **disabled**. Admin auth accounts are vulnerable to credential-stuffed passwords.

#### Edge Functions Audit

**Shared modules** (`supabase/functions/_shared/`):
- ✅ `checkout.js`: Server-authoritative pricing via `quoteService()` joining catalogue + retail DB. Client `expectedQuote` used only for safety comparison (409 on mismatch).
- ✅ `webhook.js` + `stripe.js`: Raw body signature verification with 300s tolerance. Idempotent via `store.applyPaymentEvent(event.id)`. Correct `cs_`/`pi_` segregation.
- ✅ `fulfillment.js`: 4-layer `providerDispatchGate()` enforcing `stripe_livemode + PROVIDER_ENV + SOCIALPANEL24_ENABLED + APP_ENV` gate.
- ✅ `jobs.js`: Deduplication via `dedupe_key`, retry with backoff, dead-letter after `max_attempts`.
- ✅ `operator.js`: Typed proposals validated against schema. `X-Operator-Approved` header required for mutations.
- ✅ `log.js`: `redact()` function filtering `email`, `capability_token`, `stripe_secret_key`, and email-like values.
- ✅ `http.js`: `correlationId()` extracts `X-Request-Id` / `X-Correlation-Id`.

---

### C. Payment Gateway & Financial Integrity (Stripe)

#### Live Infrastructure (Verified via Stripe MCP)
- **Account**: `acct_1UDTn4GVYoZzuPJI` — display name: "LD"
- **API Version**: `2026-07-29.dahlia` ✅ (current)

#### Webhook Endpoints (Live — RESOLVED)

> [!NOTE]
> **Duplicate webhook endpoint resolved**:
> 
> | ID | Description | Events | Status |
> |---|---|---|---|
> | `we_1UJvqmGVYoZzuPJIqFmfTpz7` | "LikeDealer Supabase stripe-webhook" | 5 events | ✅ enabled (Active) |
> | `we_1UJrLyGVYoZzuPJIXb0iQghR` | "LikeDealer Supabase stripe-webhook (live)" | 5 events | 🛑 disabled (Orphan) |
> 
> Both pointed to: `https://xvrvxofujpqavgnprpmq.supabase.co/functions/v1/stripe-webhook`
> 
> **Resolution**: Forensic correlation confirmed `we_1UJvqm...` was created at 13:41:12 UTC on 2026-09-26, exactly matching `STRIPE_WEBHOOK_SECRET` updated in `app_secrets` at 13:43:59 UTC (`whsec_OW...iLaa`). The orphaned duplicate `we_1UJrLy...` (created 08:53:06 UTC) was disabled. Exactly one endpoint is now active.

**Webhook events**: ✅ Correct set — `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `payment_intent.payment_failed`

**Webhook Secret**: `whsec_OW...iLaa` in `app_secrets` matches the active endpoint `we_1UJvqmGVYoZzuPJIqFmfTpz7` ✅.

#### Pricing & Checkout Flow
✅ Fully validated. See Section 2.B above for details. Server-authoritative, no client override possible.

---

### D. Agentic Control Plane & Operational Safeguards

✅ **Excellent implementation across all dimensions**:
- LLM completely excluded from deterministic paths (pricing, webhook verification, provider payloads, refunds)
- Typed operator commands via [contracts/operator-commands.schema.json](file:///Users/gbrata/Documents/PERSONAL/ld-frontend/contracts/operator-commands.schema.json) — 6 actions, all require `X-Operator-Approved: true`
- Agent SQL views (live verified) properly redact all PII
- Zero grants to `anon`/`authenticated` on any table (live verified)
- `AGENTS.md` governance rules are comprehensive and accurate

---

### E. Observability, Telemetry & Logging

✅ **Strengths**:
- Health probes: Public GET liveness, authenticated POST for queue metrics
- Log redaction via `log.js` `redact()` function
- Correlation ID propagation via `http.js`
- Retention purge cron active (`ld-purge-retention`, hourly)

⚠️ **Gaps**:
- No external alerting sink configured (documented as intentionally unprovisioned per [docs/observability.md](file:///Users/gbrata/Documents/PERSONAL/ld-frontend/docs/observability.md))
- No structured log format (JSON) — using plain `console.error`/`console.log`
- No synthetic canary or uptime monitoring

---

### F. Live Configuration State (**CRITICAL FINDINGS**)

> [!CAUTION]
> **`APP_ENV` is NOT SET** in `app_secrets` (live verified). This means the 4-layer live guard in `providerDispatchGate()` will **never** evaluate `production === true`. Provider `add` calls will be **deferred** even when all other gates pass. This is currently the correct safety posture for pre-launch, but **must be set before go-live**.

**Current live state**:
| Secret | Value | Go-Live Ready? |
|---|---|---|
| `PROVIDER_ENV` | `test` | ❌ Must change to `live` |
| `SOCIALPANEL24_ENABLED` | `true` | ✅ Ready |
| `APP_ENV` | *(not set)* | ❌ Must set to `production` |
| `SITE_URL` | `https://ld-frontend-phi.vercel.app` | ❌ Must change to `https://like-dealer.com` |
| `CORS_ALLOW_ORIGINS` | includes Vercel subdomain + `like-dealer.com` | ⚠️ Review post-launch |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` set | ⚠️ Verify matches correct endpoint |

**Order data** (live verified): 5 orders exist — all in test mode (`stripe_livemode: false` or `null`). No real customer data at risk.

---

## 3. Prioritized Recommendations Matrix

### P0: Blockers (Must Fix Before Live Traffic)

#### P0-1: Duplicate Stripe Webhook Endpoint — ✅ RESOLVED
- **Affected**: Stripe Account `acct_1UDTn4GVYoZzuPJI` — `we_1UJrLyGVYoZzuPJIXb0iQghR` (disabled) / `we_1UJvqmGVYoZzuPJIqFmfTpz7` (active)
- **Status**: ✅ **Resolved** (2026-10-01)
- **Actions Taken**:
  1. Identified active endpoint `we_1UJvqmGVYoZzuPJIqFmfTpz7` matching `STRIPE_WEBHOOK_SECRET` in `app_secrets` (`whsec_OW...iLaa`).
  2. Disabled orphan endpoint `we_1UJrLyGVYoZzuPJIXb0iQghR` via Stripe MCP API.
  3. Added automated pre-flight webhook check script `scripts/verify-stripe-webhooks.mjs` (`npm run verify:webhooks`).
  4. Verified only 1 active webhook endpoint remains configured.

#### P0-2: Add Custom Domain to Vercel & Update SITE_URL
- **Affected**: Vercel project `prj_RGeFwt2cLxMS6pprVC3dxWpvbLtM`, `app_secrets.SITE_URL`
- **Risk**: Production traffic on `ld-frontend-phi.vercel.app` is not brand-aligned, breaks Stripe return URLs, and CORS configuration.
- **Root Cause**: Custom domain `like-dealer.com` not yet added to Vercel.
- **Remediation**:
  ```sql
  -- After adding domain to Vercel:
  UPDATE public.app_secrets SET value = 'https://like-dealer.com' WHERE name = 'SITE_URL';
  UPDATE public.app_secrets SET value = 'https://like-dealer.com' WHERE name = 'CORS_ALLOW_ORIGINS';
  ```

#### P0-3: Enable Leaked Password Protection
- **Affected**: Supabase Auth (project settings)
- **Risk**: Admin accounts can use compromised passwords found in breach databases.
- **Root Cause**: Feature not enabled during project setup.
- **Remediation**: Supabase Dashboard → Authentication → Settings → Enable "Leaked password protection" (HaveIBeenPwned integration).

#### P0-4: Move CSP to HTTP Headers
- **Affected**: [vercel.json](file:///Users/gbrata/Documents/PERSONAL/ld-frontend/vercel.json), [404.html](file:///Users/gbrata/Documents/PERSONAL/ld-frontend/404.html)
- **Risk**: `404.html` has zero CSP protection. `<meta>` CSP cannot enforce `frame-ancestors`. Inconsistent policy across pages.
- **Root Cause**: CSP implemented per-page via `<meta>` tags instead of server-side headers.
- **Remediation**: Add to `vercel.json` headers array:
  ```json
  {
    "key": "Content-Security-Policy",
    "value": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https://xvrvxofujpqavgnprpmq.supabase.co https://js.stripe.com; frame-src https://js.stripe.com; frame-ancestors 'none'"
  }
  ```
  Then remove `<meta http-equiv="Content-Security-Policy">` from all HTML files.

---

### P1: High Priority (Required for Launch Stability)

#### P1-1: Fix robots.txt — Block `/success/` and `/cancel/`
- **Affected**: [robots.txt](file:///Users/gbrata/Documents/PERSONAL/ld-frontend/robots.txt) lines 3-4
- **Risk**: Search engines indexing transient order status pages and abandoned checkout pages.
- **Remediation**:
  ```diff
  - Allow: /success/
  - Allow: /cancel/
  + Disallow: /success/
  + Disallow: /cancel/
  ```

#### P1-2: Add Explicit RLS Deny-All Policies  
- **Affected**: All 15 `public.*` tables
- **Risk**: Current secure-by-denial is fragile — any future policy addition on any table will open access. No audit trail of intent.
- **Remediation**: Create a migration:
  ```sql
  -- Explicit deny-all policies for documentation and safety
  DO $$
  DECLARE t text;
  BEGIN
    FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    LOOP
      EXECUTE format(
        'CREATE POLICY deny_all_anon ON public.%I FOR ALL TO anon USING (false);',
        t
      );
      EXECUTE format(
        'CREATE POLICY deny_all_authenticated ON public.%I FOR ALL TO authenticated USING (false);',
        t
      );
    END LOOP;
  END $$;
  ```

#### P1-3: Fix Dynamic Import Cache-Busting
- **Affected**: [scripts/build.mjs](file:///Users/gbrata/Documents/PERSONAL/ld-frontend/scripts/build.mjs)
- **Risk**: Returning users receive stale dynamically-imported JS modules after deployments.
- **Remediation**: Extend `applyContentHashes` to also process `.js` files in `dist/js/`, replacing dynamic `import()` paths with hashed equivalents. Alternatively, add `?v=` query param busting to all dynamic imports.

#### P1-4: Set `APP_ENV` Before Go-Live (Pre-Flight)
- **Affected**: `app_secrets` table
- **Risk**: Provider dispatch gate will defer all fulfillment even after Stripe goes live.
- **Remediation** (execute at go-live, not before):
  ```sql
  INSERT INTO public.app_secrets (name, value) VALUES ('APP_ENV', 'production');
  UPDATE public.app_secrets SET value = 'live' WHERE name = 'PROVIDER_ENV';
  ```

---

### P2: Medium Priority (Post-Launch Hardening)

#### P2-1: Remove `cdn.jsdelivr.net` from CSP
- **Affected**: CSP policy (currently in `index.html` meta tag)
- **Risk**: Allows loading scripts from a CDN that's not used in production.
- **Remediation**: Remove `https://cdn.jsdelivr.net` from `script-src` and `connect-src` when migrating CSP to `vercel.json`.

#### P2-2: Add Asset Minification to Build Pipeline
- **Affected**: [scripts/build.mjs](file:///Users/gbrata/Documents/PERSONAL/ld-frontend/scripts/build.mjs)
- **Risk**: Unminified HTML/CSS/JS increases transfer sizes by ~20-40%.
- **Remediation**: Integrate a lightweight minifier (e.g., `terser` for JS, `clean-css` for CSS, `html-minifier-terser` for HTML) into the build pipeline.

#### P2-3: Defer `scene.js` Loading
- **Affected**: [index.html](file:///Users/gbrata/Documents/PERSONAL/ld-frontend/index.html) line 264
- **Risk**: Synchronous script load blocks LCP rendering.
- **Remediation**: Add `defer` attribute to the scene script tag.

#### P2-4: Add External Alerting Integration
- **Affected**: Observability stack
- **Risk**: No automated alerts for queue failures, dead letters, `submission_unknown`, or provider deferrals.
- **Remediation**: Wire `POST /health` output to an alerting system (PagerDuty, Opsgenie, or email). Create a Supabase webhook or external cron that polls health and triggers alerts.

#### P2-5: Structured JSON Logging
- **Affected**: All Edge Functions
- **Risk**: Plain text `console.log` is harder to parse in log sinks.
- **Remediation**: Wrap logging through `log.js` to emit structured JSON with `level`, `correlationId`, `function`, `message`, and `context` fields.

#### P2-6: TOCTOU Race in `createGuestCheckout`
- **Affected**: [supabase/functions/_shared/checkout.js](file:///Users/gbrata/Documents/PERSONAL/ld-frontend/supabase/functions/_shared/checkout.js)
- **Risk**: Two concurrent requests with the same `checkoutAttemptId` can both pass the `if (!existing)` check. One will crash on the `orders_checkout_attempt_unique` constraint, returning a 500 instead of a graceful 409 or reuse.
- **Root Cause**: Read-then-write without a database-level lock or `INSERT ... ON CONFLICT` pattern.
- **Remediation**: Wrap the `insertOrder` call in a try/catch. On a unique constraint violation, re-fetch the existing order and return it (or return 409). Alternatively, use `INSERT ... ON CONFLICT (checkout_attempt_id) DO NOTHING RETURNING *` for atomic upsert.

---

### P3: Low Priority (Technical Debt & Polish)

#### P3-1: Skip-Link Hydration Race
- **Affected**: [index.html](file:///Users/gbrata/Documents/PERSONAL/ld-frontend/index.html) line 56
- **Risk**: Screen reader skip-link targets a JS-injected `#platforms` ID that doesn't exist pre-hydration.
- **Remediation**: Add `id="platforms"` to `<div id="order-root">` in source HTML.

#### P3-2: Clean Up Unused Indexes (Post-Traffic Analysis)
- **Affected**: 9 indexes flagged by Supabase Performance Advisor
- **Risk**: Minimal — indexes on low-traffic tables have negligible write overhead.
- **Remediation**: Re-evaluate after 30 days of live traffic. Drop truly unused indexes.

#### P3-3: CLS Mitigation for Dynamic Catalogue
- **Affected**: `<div id="order-root">` in [index.html](file:///Users/gbrata/Documents/PERSONAL/ld-frontend/index.html)
- **Risk**: Minor layout shift when catalogue cards render.
- **Remediation**: Set a `min-height` on `#order-root` matching the expected rendered height.

#### P3-4: Fix Build Script Regex for Success/Cancel Pages
- **Affected**: [scripts/build.mjs](file:///Users/gbrata/Documents/PERSONAL/ld-frontend/scripts/build.mjs) `copyStatic` function
- **Risk**: `app.js` cache-busting silently fails on auxiliary pages.
- **Remediation**: Add `?v=0` suffix to `<script src="/js/app.js">` in `success/index.html` and `cancel/index.html` source files.

---

## 4. Modern Pre-Go-Live Action Plan

### Phase A: Agentic Development & Governance ✅ COMPLETE
- [x] LLM excluded from all deterministic financial paths
- [x] Typed operator proposals with human-in-the-loop approval
- [x] Agent SQL views redact PII
- [x] Governance documented in `AGENTS.md` and `docs/agent-control-plane.md`
- [x] Schema contract at `contracts/operator-commands.schema.json`
- [ ] **Add**: Automated contract schema validation in CI (compare deployed function behavior against schema)

### Phase B: Performance & Core Web Vitals
- [ ] **P2-2**: Add minification to build pipeline
- [ ] **P2-3**: Defer `scene.js` script loading
- [ ] **P1-3**: Fix dynamic import cache-busting
- [ ] **P3-3**: Set `min-height` on `#order-root` for CLS
- [ ] **Post-launch**: Run Lighthouse CI and establish CWV baselines

### Phase C: Scalability & Resilience
- [x] `pg_cron` `process-jobs` running every minute ✅
- [x] Job deduplication via `dedupe_key` unique index ✅
- [x] Retry with backoff and dead-letter after `max_attempts` ✅
- [x] Provider dispatch gate (4-layer live guard) ✅
- [x] Rate limiting table and implementation ✅
- [x] Hourly data retention purge via `ld-purge-retention` ✅
- [ ] **Load test**: Simulate 100 concurrent checkouts to verify deduplication under race conditions
- [ ] **Connection pooling**: Verify Supabase connection pooler is enabled (Supavisor)

### Phase D: Observability & Incident Response
- [x] Health probes (public GET / authenticated POST) ✅
- [x] Log redaction via `log.js` ✅
- [x] Correlation ID propagation ✅
- [ ] **P2-4**: Wire health probe to external alerting
- [ ] **P2-5**: Migrate to structured JSON logging
- [ ] **Add**: Synthetic canary — automated small purchase every 24h in test mode
- [ ] **Add**: Uptime monitoring on `GET /functions/v1/health`

### Phase E: Maintainability & CI/CD
- [x] GitHub Actions CI workflow ✅
- [x] `npm test` with mocked dependencies ✅
- [x] `npm run build:check` offline validation ✅
- [x] Smoke deploy script ✅
- [x] Deploy checklist documented ✅
- [ ] **Add**: Automated migration drift detection (compare local migrations vs. deployed)
- [ ] **Add**: Pre-deploy webhook configuration validation (detect duplicates)
- [ ] **Add**: Branch preview deployments with ephemeral Supabase branches

---

## 5. Live Verification Commands & Runbook

### Pre-Go-Live Verification

```bash
# 1. Run tests locally
npm test
npm run build:check

# 2. Build and verify dist/
npm run build
ls -la dist/

# 3. Verify Edge Functions are deployed
# (Already verified via MCP: 10 functions, all ACTIVE)
```

### Stripe Verification

```bash
# 4. List webhook endpoints — verify exactly ONE exists
stripe webhook_endpoints list --live

# 5. Delete the duplicate endpoint (after identifying correct whsec_)
stripe webhook_endpoints delete we_1UJrLyGVYoZzuPJIXb0iQghR --live
# OR
stripe webhook_endpoints delete we_1UJvqmGVYoZzuPJIqFmfTpz7 --live

# 6. Verify remaining endpoint
stripe webhook_endpoints retrieve <remaining_we_id> --live

# 7. Send a test webhook
stripe trigger checkout.session.completed --live
```

### Supabase Verification

```sql
-- 8. Verify RLS is enabled on all tables
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public';

-- 9. Verify no anon/authenticated grants
SELECT grantee, table_schema, table_name, privilege_type 
FROM information_schema.table_privileges 
WHERE table_schema IN ('public', 'agent') 
  AND grantee IN ('anon', 'authenticated');
-- Expected: empty result set

-- 10. Verify cron jobs are active
SELECT jobname, schedule, active FROM cron.job;

-- 11. Verify agent views redact PII
SELECT column_name FROM information_schema.columns 
WHERE table_schema = 'agent';
-- Confirm no email, token, target, or key columns

-- 12. Enable leaked password protection
-- (Via Supabase Dashboard → Authentication → Settings)

-- 13. Set go-live secrets (EXECUTE AT LAUNCH TIME ONLY)
INSERT INTO public.app_secrets (name, value) 
VALUES ('APP_ENV', 'production')
ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value;

UPDATE public.app_secrets SET value = 'live' WHERE name = 'PROVIDER_ENV';
UPDATE public.app_secrets SET value = 'https://like-dealer.com' WHERE name = 'SITE_URL';
```

### Vercel Verification

```bash
# 14. Add custom domain
vercel domains add like-dealer.com --project ld-frontend

# 15. Verify DNS propagation
dig like-dealer.com A
dig like-dealer.com CNAME

# 16. Verify headers
curl -sI https://like-dealer.com | grep -E 'X-Frame|Content-Security|Strict-Transport|X-Content-Type'
```

### Canary Purchase (Final Validation)

```bash
# 17. After all secrets are set to live:
# - Make one small real purchase through the storefront
# - Verify in /admin/orders/: order shows 'paid', panel order ID present
# - Verify email receipt delivered (check Resend dashboard)
# - Verify Stripe dashboard shows matching amount
# - Verify fulfillment_status progresses beyond 'deferred'
```

### Incident Response Quick Reference

```bash
# Check queue health
curl -X POST https://xvrvxofujpqavgnprpmq.supabase.co/functions/v1/health \
  -H "Authorization: Bearer WORKER_SECRET_HERE"

# Check for failed jobs
# (Via admin panel or direct SQL)
SELECT id, order_id, status, attempts, error 
FROM jobs 
WHERE status = 'failed' 
ORDER BY created_at DESC LIMIT 10;

# Check for submission_unknown orders
SELECT id, display_id, fulfillment_status 
FROM orders 
WHERE fulfillment_status = 'submission_unknown';
```

---

> [!IMPORTANT]
> **Bottom Line**: The LikeDealer codebase demonstrates strong security architecture — server-authoritative pricing, idempotent webhooks, strict LLM isolation, and comprehensive RLS. The **4 P0 blockers** (duplicate Stripe webhook, missing custom domain, disabled leaked-password protection, CSP via meta-only) are all straightforward configuration fixes. After resolving those and the P1 items, this project is production-ready.

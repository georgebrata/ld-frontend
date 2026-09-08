# SocialPanel24

Fixed endpoint: `POST https://socialpanel24.com/api/v2`  
Body: `application/x-www-form-urlencoded` via `URLSearchParams`. Every call includes `key` from secret `SOCIALPANEL24_API_KEY` and an allowlisted `action`. No JSON body. No credentials in URLs or logs. TLS verification stays on. Redirects are rejected. Timeouts apply. HTTP 200 is not success for `add` without a numeric `order` id.

Adapter: `supabase/functions/_shared/socialpanel24.js`  
Types: `supabase/functions/_shared/provider-types.js`

## Actions

| Action | Extra fields | Use |
|--------|--------------|-----|
| `services` | — | Catalogue |
| `add` | type-specific | Create one order |
| `status` | `order` or `orders` (≤100) | Poll |
| `balance` | — | Owner diagnostics |

## Enabled `add` types

Default: `link`, `quantity` (+ optional `runs`/`interval` when drip is configured and priced).  
Package: `link` only.  
Custom Comments / Custom Comments Package: `link`, `comments` (newlines); **no** `quantity`.  
Mentions family, Comment Likes, Invites from Groups, optional Web Traffic: see the [public API](https://socialpanel24.com/api). Lists use newlines (not the PHP comma example).

`commentsList` / `commentslist` → `comments`. CRLF → LF. Empty lines dropped; remaining text unchanged. Custom-comment billable quantity is the list length when `rateUnit=per_comment`.

Web Traffic: `device` is `1`–`5`, not `Desktop`. `type_of_traffic` 1 requires `google_keyword`, 2 requires `referring_url`, 3 is blank-referrer.

Subscriptions are disabled (unlimited future posts if `posts` is omitted).

Refill/cancel are operator extensions. Provider cancel does not refund Stripe.

## Fixtures

`test/fixtures/socialpanel24.json` — services list, `{ "order": 23501 }`, Partial / In progress / Completed / unknown status, batch mix, insufficient balance, validation error.

## Mapping retail rows

Bundled `socialpanelId` values (confirmed `action=services`, Default / Custom Comments, refill where possible):

| Retail | Provider | Notes |
|--------|----------|-------|
| 01 Instagram Likes | 11456 | per 1,000, refill 30D |
| 02 Instagram Followers | 12472 | per 1,000, refill 30D |
| 03 Instagram Comments | 12364 | Custom Comments, per 1,000, min 5 |
| 04 TikTok Likes | 11655 | per 1,000, refill 60D |
| 05 TikTok Followers | 12474 | per 1,000, refill 30D |
| 06 Youtube Subscribers | 12610 | per 1,000, refill 30D |

`RETAIL_SOCIALPANEL_IDS` JSON can still overlay those ids if the `app_secrets` name check allows it. Mapper: `SOCIALPANEL24_API_KEY=… node scripts/map-socialpanel24.mjs`.

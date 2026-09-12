# Obsolete Cloudflare Worker

This directory is **not** the production backend. Do not deploy it.

The live checkout, webhook, jobs, and catalogue run in `supabase/functions/`. The Worker still contains an unauthenticated order lookup, in-webhook fulfilment, and a historical Apps Script URL.

If you need history, read `wrangler.toml.obsolete`. New work belongs in Supabase Edge Functions.

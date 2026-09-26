#!/usr/bin/env bash
# Deploy all Edge Functions when SUPABASE_ACCESS_TOKEN is set (supabase login or dashboard PAT).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
node scripts/pack-functions.mjs >/dev/null
node scripts/deploy-all-via-api.mjs "$@"

# Agent control plane

Pricing, payment verification, webhook validation, provider payloads, retries, and refunds stay deterministic. An LLM is not in those paths.

## Allowed now

- Read-only summaries from `GET/POST /functions/v1/health` (worker secret) and sanitized docs.
- Typed **proposals** via `POST /functions/v1/operator` without `X-Operator-Approved`.

## Forbidden

- Service-role keys, worker secrets, Stripe/Resend/SocialPanel24 credentials in agent tools
- Arbitrary SQL or HTTP
- Automatic provider `add` after `submission_unknown`
- Changing payment state from model output

## Commands

See [contracts/operator-commands.schema.json](../contracts/operator-commands.schema.json). Schema version 1. Human approval required for every listed command.

Sanitized SQL views (service role): `agent.queue_health`, `agent.order_states`, `agent.catalogue_anomalies`. They omit emails, comments, tokens, and targets.

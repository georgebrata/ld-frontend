-- Quote and Stripe identifier fields used by create-checkout.
-- Hosted `orders` was created from the init migration and never received hardening.

alter table public.orders
  add column if not exists expected_provider_cost_minor integer,
  add column if not exists expected_contribution_minor integer,
  add column if not exists fx_provider_to_retail numeric,
  add column if not exists fx_quoted_at timestamptz,
  add column if not exists stripe_integration_identifier text,
  add column if not exists min_contribution_minor integer;

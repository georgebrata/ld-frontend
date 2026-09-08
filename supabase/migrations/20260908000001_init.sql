-- LikeDealer guest checkout: private orders, stripe events, jobs.
-- Browser roles have no table access. All writes go through Edge Functions
-- using the service role. Existing Apps Script / Worker KV orders are not
-- migrated by this file.

create extension if not exists pgcrypto;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  display_id text not null,
  checkout_attempt_id uuid not null,
  capability_token_hash text not null,
  email text not null,
  service_id text not null,
  service_snapshot jsonb not null,
  provider_service_id text not null,
  provider_type text not null,
  provider_payload jsonb not null,
  quantity integer not null check (quantity > 0),
  billable_quantity integer not null check (billable_quantity > 0),
  currency text not null check (char_length(currency) = 3),
  amount_minor integer not null check (amount_minor >= 0),
  quote_version text not null,
  rate_unit text not null check (rate_unit in ('per_1000', 'per_unit', 'package', 'per_comment')),
  retail_rate_minor integer not null check (retail_rate_minor >= 0),
  markup numeric not null check (markup >= 1),
  inputs jsonb not null default '{}'::jsonb,
  params_fingerprint text not null,
  payment_status text not null default 'pending'
    check (payment_status in ('pending', 'paid', 'failed', 'expired', 'cancelled')),
  fulfillment_status text not null default 'not_started'
    check (fulfillment_status in (
      'not_started', 'dispatching', 'submitted', 'in_progress', 'completed',
      'partial', 'failed', 'cancelled', 'submission_unknown', 'blocked_balance',
      'skipped_test_mode', 'review'
    )),
  stripe_session_id text,
  stripe_payment_intent_id text,
  stripe_livemode boolean,
  checkout_revision integer not null default 1 check (checkout_revision >= 1),
  provider_order_id text,
  provider_dispatched_at timestamptz,
  provider_status_raw text,
  provider_charge text,
  provider_currency text,
  provider_start_count text,
  provider_remains text,
  provider_last_status_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_checkout_attempt_unique unique (checkout_attempt_id),
  constraint orders_stripe_session_unique unique (stripe_session_id)
);

create unique index if not exists orders_provider_order_id_uidx
  on public.orders (provider_order_id)
  where provider_order_id is not null;

create index if not exists orders_payment_status_idx on public.orders (payment_status);
create index if not exists orders_fulfillment_status_idx on public.orders (fulfillment_status);
create index if not exists orders_capability_hash_idx on public.orders (capability_token_hash);
create index if not exists orders_created_at_idx on public.orders (created_at);

create table if not exists public.stripe_events (
  event_id text primary key,
  event_type text not null,
  livemode boolean not null default false,
  processed_at timestamptz not null default now()
);

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders (id),
  task text not null
    check (task in (
      'fulfill', 'poll_status', 'email_customer_payment',
      'email_owner_payment', 'email_owner_alert'
    )),
  dedupe_key text not null,
  payload jsonb not null default '{}'::jsonb,
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 12,
  next_retry_at timestamptz not null default now(),
  lease_until timestamptz,
  lease_owner text,
  status text not null default 'pending'
    check (status in ('pending', 'leased', 'succeeded', 'failed', 'skipped')),
  outcome jsonb,
  external_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint jobs_dedupe_key_unique unique (dedupe_key)
);

create index if not exists jobs_due_idx on public.jobs (status, next_retry_at);
create index if not exists jobs_order_id_idx on public.jobs (order_id);

create table if not exists public.catalogue_cache (
  cache_key text primary key,
  payload jsonb not null,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists public.rate_limits (
  bucket text not null,
  rate_key text not null,
  window_start bigint not null,
  count integer not null default 0 check (count >= 0),
  primary key (bucket, rate_key, window_start)
);

alter table public.orders enable row level security;
alter table public.stripe_events enable row level security;
alter table public.jobs enable row level security;
alter table public.catalogue_cache enable row level security;
alter table public.rate_limits enable row level security;

revoke all on table public.orders from anon, authenticated, public;
revoke all on table public.stripe_events from anon, authenticated, public;
revoke all on table public.jobs from anon, authenticated, public;
revoke all on table public.catalogue_cache from anon, authenticated, public;
revoke all on table public.rate_limits from anon, authenticated, public;

grant all on table public.orders to service_role;
grant all on table public.stripe_events to service_role;
grant all on table public.jobs to service_role;
grant all on table public.catalogue_cache to service_role;
grant all on table public.rate_limits to service_role;

create or replace function public.apply_stripe_payment_event(
  p_event_id text,
  p_event_type text,
  p_livemode boolean,
  p_order_id uuid,
  p_session_id text,
  p_amount_minor integer,
  p_currency text,
  p_payment_intent_id text,
  p_desired_payment text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ord public.orders%rowtype;
  already_paid boolean;
  should_enqueue boolean := false;
begin
  begin
    insert into public.stripe_events (event_id, event_type, livemode)
    values (p_event_id, p_event_type, p_livemode);
  exception
    when unique_violation then
      return jsonb_build_object('duplicate', true, 'enqueued', false);
  end;

  select * into ord
  from public.orders
  where (p_order_id is not null and id = p_order_id)
     or (p_session_id is not null and stripe_session_id = p_session_id)
  for update;

  if not found then
    return jsonb_build_object('duplicate', false, 'missing', true, 'enqueued', false);
  end if;

  if p_desired_payment = 'paid' then
    if ord.stripe_session_id is not null and p_session_id is not null
       and ord.stripe_session_id is distinct from p_session_id then
      return jsonb_build_object('duplicate', false, 'mismatch', 'session', 'enqueued', false);
    end if;
    if ord.amount_minor is distinct from p_amount_minor
       or lower(ord.currency) is distinct from lower(coalesce(p_currency, '')) then
      return jsonb_build_object('duplicate', false, 'mismatch', 'amount', 'enqueued', false);
    end if;
  end if;

  already_paid := ord.payment_status = 'paid';

  if already_paid then
    update public.orders
    set stripe_payment_intent_id = coalesce(p_payment_intent_id, stripe_payment_intent_id),
        stripe_livemode = p_livemode,
        updated_at = now()
    where id = ord.id;
  else
    update public.orders
    set payment_status = p_desired_payment,
        stripe_payment_intent_id = coalesce(p_payment_intent_id, stripe_payment_intent_id),
        stripe_session_id = coalesce(nullif(p_session_id, ''), stripe_session_id),
        stripe_livemode = p_livemode,
        updated_at = now()
    where id = ord.id;
  end if;

  if not already_paid and p_desired_payment = 'paid' then
    insert into public.jobs (order_id, task, dedupe_key)
    values
      (ord.id, 'fulfill', 'fulfill:' || ord.id::text),
      (ord.id, 'email_customer_payment', 'email:customer:payment:' || ord.id::text),
      (ord.id, 'email_owner_payment', 'email:owner:payment:' || ord.id::text)
    on conflict (dedupe_key) do nothing;
    should_enqueue := true;
  end if;

  return jsonb_build_object('duplicate', false, 'enqueued', should_enqueue, 'order_id', ord.id);
end;
$$;

create or replace function public.claim_jobs(
  p_worker_id text,
  p_limit integer,
  p_lease_ms integer
)
returns setof public.jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with picked as (
    select j.id
    from public.jobs j
    where j.status in ('pending', 'leased')
      and j.next_retry_at <= now()
      and (j.lease_until is null or j.lease_until < now())
    order by j.next_retry_at
    for update skip locked
    limit greatest(p_limit, 1)
  )
  update public.jobs as job
  set status = 'leased',
      lease_owner = p_worker_id,
      lease_until = now() + make_interval(secs => greatest(p_lease_ms, 1000) / 1000.0),
      attempts = job.attempts + 1,
      updated_at = now()
  from picked
  where job.id = picked.id
  returning job.*;
end;
$$;

create or replace function public.consume_rate_limit(
  p_bucket text,
  p_key text,
  p_limit integer,
  p_window_sec integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  win bigint;
  new_count integer;
begin
  win := floor(extract(epoch from now()) / p_window_sec);
  insert into public.rate_limits (bucket, rate_key, window_start, count)
  values (p_bucket, p_key, win, 1)
  on conflict (bucket, rate_key, window_start)
  do update set count = public.rate_limits.count + 1
  returning count into new_count;
  return jsonb_build_object('allowed', new_count <= p_limit, 'count', new_count);
end;
$$;

revoke all on function public.apply_stripe_payment_event(text, text, boolean, uuid, text, integer, text, text, text) from public, anon, authenticated;
revoke all on function public.claim_jobs(text, integer, integer) from public, anon, authenticated;
revoke all on function public.consume_rate_limit(text, text, integer, integer) from public, anon, authenticated;

grant execute on function public.apply_stripe_payment_event(text, text, boolean, uuid, text, integer, text, text, text) to service_role;
grant execute on function public.claim_jobs(text, integer, integer) to service_role;
grant execute on function public.consume_rate_limit(text, text, integer, integer) to service_role;

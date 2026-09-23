-- Hardening: fail-closed provider defaults, Stripe event outcomes, bounded jobs,
-- contribution fields, audit/outbox tables, retention helpers.

alter table public.orders drop constraint if exists orders_fulfillment_status_check;
alter table public.orders
  add constraint orders_fulfillment_status_check
  check (fulfillment_status in (
    'not_started', 'dispatching', 'submitted', 'in_progress', 'completed',
    'partial', 'failed', 'cancelled', 'submission_unknown', 'blocked_balance',
    'skipped_test_mode', 'deferred', 'review'
  ));

alter table public.orders
  add column if not exists expected_provider_cost_minor integer,
  add column if not exists expected_contribution_minor integer,
  add column if not exists fx_provider_to_retail numeric,
  add column if not exists fx_quoted_at timestamptz,
  add column if not exists stripe_integration_identifier text,
  add column if not exists min_contribution_minor integer;

alter table public.products
  add column if not exists min_contribution_minor integer not null default 30;

alter table public.stripe_events
  add column if not exists outcome text not null default 'accepted',
  add column if not exists mismatch text,
  add column if not exists object_id text,
  add column if not exists session_id text,
  add column if not exists payment_intent_id text;

alter table public.stripe_events drop constraint if exists stripe_events_outcome_check;
alter table public.stripe_events
  add constraint stripe_events_outcome_check
  check (outcome in ('received', 'accepted', 'ignored', 'rejected', 'duplicate'));

alter table public.jobs drop constraint if exists jobs_task_check;
alter table public.jobs
  add constraint jobs_task_check
  check (task in (
    'fulfill', 'poll_status', 'poll_provider_status', 'purge_rate_limits',
    'email_customer_payment', 'email_owner_payment', 'email_owner_alert'
  ));

create table if not exists public.external_requests (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders (id),
  job_id uuid references public.jobs (id),
  vendor text not null,
  action text not null,
  fingerprint text not null default '',
  idempotency_key text,
  attempted_at timestamptz not null default now(),
  outcome text,
  external_ref text,
  created_at timestamptz not null default now()
);

create index if not exists external_requests_order_idx on public.external_requests (order_id, attempted_at desc);

create table if not exists public.order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders (id),
  actor text not null default 'system',
  action text not null,
  from_state text,
  to_state text,
  reason text,
  correlation_id text,
  created_at timestamptz not null default now()
);

create table if not exists public.operator_actions (
  id uuid primary key default gen_random_uuid(),
  command text not null,
  schema_version text not null default '1',
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'proposed'
    check (status in ('proposed', 'approved', 'rejected', 'executed', 'failed')),
  actor text,
  approver text,
  result jsonb,
  idempotency_key text unique,
  created_at timestamptz not null default now(),
  executed_at timestamptz
);

create table if not exists public.retention_settings (
  name text primary key,
  days integer not null check (days >= 1)
);

insert into public.retention_settings (name, days) values
  ('rate_limits', 1),
  ('job_outcomes', 90),
  ('order_pii', 730),
  ('stripe_events', 730),
  ('external_requests', 365)
on conflict (name) do nothing;

alter table public.external_requests enable row level security;
alter table public.order_events enable row level security;
alter table public.operator_actions enable row level security;
alter table public.retention_settings enable row level security;

revoke all on table public.external_requests from anon, authenticated, public;
revoke all on table public.order_events from anon, authenticated, public;
revoke all on table public.operator_actions from anon, authenticated, public;
revoke all on table public.retention_settings from anon, authenticated, public;

grant all on table public.external_requests to service_role;
grant all on table public.order_events to service_role;
grant all on table public.operator_actions to service_role;
grant all on table public.retention_settings to service_role;

insert into public.app_secrets (name, value)
values ('SOCIALPANEL24_ENABLED', 'false'), ('PROVIDER_ENV', 'test'), ('APP_ENV', 'development')
on conflict (name) do update
set value = excluded.value
where public.app_secrets.name in ('SOCIALPANEL24_ENABLED', 'PROVIDER_ENV')
  and public.app_secrets.value in ('true', 'test', 'live');

-- Force fail-closed provider enablement on existing default-true rows.
update public.app_secrets
set value = 'false'
where name = 'SOCIALPANEL24_ENABLED' and value = 'true';

drop function if exists public.apply_stripe_payment_event(text, text, boolean, uuid, text, integer, text, text, text);

create or replace function public.apply_stripe_payment_event(
  p_event_id text,
  p_event_type text,
  p_livemode boolean,
  p_order_id uuid,
  p_session_id text,
  p_amount_minor integer,
  p_currency text,
  p_payment_intent_id text,
  p_desired_payment text,
  p_object_id text default null
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
  existing public.stripe_events%rowtype;
  session_id text;
  intent_id text;
begin
  session_id := case when p_session_id like 'cs_%' then p_session_id else null end;
  intent_id := case when p_payment_intent_id like 'pi_%' then p_payment_intent_id else null end;

  select * into existing from public.stripe_events where event_id = p_event_id;
  if found and existing.outcome in ('accepted', 'ignored', 'duplicate') then
    return jsonb_build_object('duplicate', true, 'enqueued', false, 'outcome', 'duplicate');
  end if;

  if p_desired_payment is null then
    insert into public.stripe_events (event_id, event_type, livemode, outcome, object_id, session_id, payment_intent_id)
    values (p_event_id, p_event_type, p_livemode, 'ignored', p_object_id, session_id, intent_id)
    on conflict (event_id) do update set outcome = 'ignored';
    return jsonb_build_object('duplicate', false, 'ignored', true, 'enqueued', false, 'outcome', 'ignored');
  end if;

  select * into ord
  from public.orders
  where (p_order_id is not null and id = p_order_id)
     or (session_id is not null and stripe_session_id = session_id)
     or (intent_id is not null and stripe_payment_intent_id = intent_id)
  for update;

  if not found then
    insert into public.stripe_events (event_id, event_type, livemode, outcome, object_id, session_id, payment_intent_id)
    values (p_event_id, p_event_type, p_livemode, 'ignored', p_object_id, session_id, intent_id)
    on conflict (event_id) do update set outcome = 'ignored';
    return jsonb_build_object('duplicate', false, 'missing', true, 'enqueued', false, 'outcome', 'ignored');
  end if;

  if ord.stripe_session_id is not null and session_id is not null
     and ord.stripe_session_id is distinct from session_id then
    insert into public.stripe_events (event_id, event_type, livemode, outcome, mismatch, object_id, session_id, payment_intent_id)
    values (p_event_id, p_event_type, p_livemode, 'rejected', 'session', p_object_id, session_id, intent_id)
    on conflict (event_id) do update set outcome = 'rejected', mismatch = 'session';
    return jsonb_build_object('duplicate', false, 'mismatch', 'session', 'enqueued', false, 'outcome', 'rejected');
  end if;

  if p_desired_payment = 'paid' then
    if ord.amount_minor is distinct from p_amount_minor
       or lower(ord.currency) is distinct from lower(coalesce(p_currency, '')) then
      insert into public.stripe_events (event_id, event_type, livemode, outcome, mismatch, object_id, session_id, payment_intent_id)
      values (p_event_id, p_event_type, p_livemode, 'rejected', 'amount', p_object_id, session_id, intent_id)
      on conflict (event_id) do update set outcome = 'rejected', mismatch = 'amount';
      return jsonb_build_object('duplicate', false, 'mismatch', 'amount', 'enqueued', false, 'outcome', 'rejected');
    end if;
  end if;

  already_paid := ord.payment_status = 'paid';

  if already_paid then
    update public.orders
    set stripe_payment_intent_id = coalesce(intent_id, stripe_payment_intent_id),
        stripe_livemode = p_livemode,
        updated_at = now()
    where id = ord.id;
  else
    update public.orders
    set payment_status = p_desired_payment,
        stripe_payment_intent_id = coalesce(intent_id, stripe_payment_intent_id),
        stripe_session_id = coalesce(session_id, stripe_session_id),
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

  insert into public.stripe_events (event_id, event_type, livemode, outcome, object_id, session_id, payment_intent_id)
  values (p_event_id, p_event_type, p_livemode, 'accepted', p_object_id, session_id, intent_id)
  on conflict (event_id) do update set outcome = 'accepted', mismatch = null;

  return jsonb_build_object('duplicate', false, 'enqueued', should_enqueue, 'outcome', 'accepted', 'order_id', ord.id);
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
      and j.attempts < j.max_attempts
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

create or replace function public.purge_expired_rate_limits()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted integer;
begin
  delete from public.rate_limits
  where window_start < floor(extract(epoch from now()) / 60) - 120;
  get diagnostics deleted = row_count;
  return deleted;
end;
$$;

revoke all on function public.apply_stripe_payment_event(text, text, boolean, uuid, text, integer, text, text, text, text) from public, anon, authenticated;
grant execute on function public.apply_stripe_payment_event(text, text, boolean, uuid, text, integer, text, text, text, text) to service_role;
revoke all on function public.claim_jobs(text, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_jobs(text, integer, integer) to service_role;
revoke all on function public.purge_expired_rate_limits() from public, anon, authenticated;
grant execute on function public.purge_expired_rate_limits() to service_role;

alter table public.orders drop constraint if exists orders_customer_email_state_check;
alter table public.orders add constraint orders_customer_email_state_check check (
  customer_email_state in ('unknown', 'queued', 'sent', 'accepted', 'delivered', 'bounced', 'failed')
);

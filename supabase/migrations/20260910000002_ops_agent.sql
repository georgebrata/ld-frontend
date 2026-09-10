-- Private agent views, job attempt ledger, append-only order events, retention cron.

create schema if not exists ops;
create schema if not exists agent;

revoke all on schema ops from public, anon, authenticated;
revoke all on schema agent from public, anon, authenticated;
grant usage on schema ops to service_role;
grant usage on schema agent to service_role;

create table if not exists public.job_attempts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.jobs (id),
  order_id uuid references public.orders (id),
  task text not null default '',
  attempt integer not null default 0,
  outcome text,
  correlation_id text,
  created_at timestamptz not null default now()
);

create index if not exists job_attempts_job_idx on public.job_attempts (job_id, created_at desc);

alter table public.job_attempts enable row level security;
revoke all on table public.job_attempts from anon, authenticated, public;
grant all on table public.job_attempts to service_role;

create or replace function public.append_order_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.order_events (order_id, actor, action, from_state, to_state, reason)
  values (
    new.id,
    'system',
    tg_op,
    case when tg_op = 'UPDATE' then old.payment_status || '/' || old.fulfillment_status else null end,
    new.payment_status || '/' || new.fulfillment_status,
    null
  );
  return new;
end;
$$;

drop trigger if exists orders_append_event on public.orders;
create trigger orders_append_event
after insert or update of payment_status, fulfillment_status on public.orders
for each row execute procedure public.append_order_event();

revoke all on function public.append_order_event() from public, anon, authenticated;

create or replace view agent.queue_health as
select
  count(*) filter (where status = 'pending') as jobs_pending,
  count(*) filter (where status = 'failed') as jobs_failed,
  count(*) filter (where status = 'leased') as jobs_leased,
  count(*) filter (where status = 'succeeded') as jobs_succeeded
from public.jobs;

create or replace view agent.order_states as
select
  id,
  display_id,
  payment_status,
  fulfillment_status,
  amount_minor,
  currency,
  expected_provider_cost_minor,
  expected_contribution_minor,
  created_at
from public.orders;

create or replace view agent.catalogue_anomalies as
select
  id,
  platform,
  service,
  visible,
  socialpanel_id is null or socialpanel_id = '' as unmapped,
  min_contribution_minor
from public.products;

revoke all on agent.queue_health, agent.order_states, agent.catalogue_anomalies from public, anon, authenticated;
grant select on agent.queue_health, agent.order_states, agent.catalogue_anomalies to service_role;

create or replace function public.purge_retained_rows()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  rate_days integer := 1;
  job_days integer := 90;
  request_days integer := 365;
  deleted_rates integer := 0;
  deleted_attempts integer := 0;
  deleted_requests integer := 0;
begin
  select days into rate_days from public.retention_settings where name = 'rate_limits';
  select days into job_days from public.retention_settings where name = 'job_outcomes';
  select days into request_days from public.retention_settings where name = 'external_requests';

  deleted_rates := public.purge_expired_rate_limits();
  delete from public.job_attempts where created_at < now() - make_interval(days => greatest(coalesce(job_days, 90), 1));
  get diagnostics deleted_attempts = row_count;
  delete from public.external_requests where created_at < now() - make_interval(days => greatest(coalesce(request_days, 365), 1));
  get diagnostics deleted_requests = row_count;

  return jsonb_build_object(
    'rate_limits', deleted_rates,
    'job_attempts', deleted_attempts,
    'external_requests', deleted_requests
  );
end;
$$;

revoke all on function public.purge_retained_rows() from public, anon, authenticated;
grant execute on function public.purge_retained_rows() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid)
    from cron.job
    where jobname = 'ld-purge-retention';
    perform cron.schedule('ld-purge-retention', '17 * * * *', 'select public.purge_retained_rows()');
  end if;
end;
$$;

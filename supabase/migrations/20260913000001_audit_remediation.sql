-- Audit remediation: FK indexes and aggregate health snapshot (forward-only).

create index if not exists external_requests_job_id_idx on public.external_requests (job_id);
create index if not exists job_attempts_order_id_idx on public.job_attempts (order_id);
create index if not exists order_events_order_id_idx on public.order_events (order_id);

create or replace function public.count_ops_snapshot()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'jobsPending', (select count(*)::int from public.jobs where status = 'pending'),
    'jobsFailed', (select count(*)::int from public.jobs where status = 'failed'),
    'jobsLeased', (select count(*)::int from public.jobs where status = 'leased'),
    'unknownSubmissions', (
      select count(*)::int from public.orders where fulfillment_status = 'submission_unknown'
    ),
    'deferredFulfillment', (
      select count(*)::int from public.orders where fulfillment_status = 'deferred'
    ),
    'paidUnfulfilled', (
      select count(*)::int
      from public.orders
      where payment_status = 'paid'
        and fulfillment_status not in ('completed', 'skipped_test_mode')
    )
  );
$$;

revoke all on function public.count_ops_snapshot() from public, anon, authenticated;
grant execute on function public.count_ops_snapshot() to service_role;

-- Admin order list indexes, refill columns, and refill job tasks.

create index if not exists orders_email_idx on public.orders (email);
create index if not exists orders_status_created_idx on public.orders (payment_status, created_at desc);

alter table public.orders
  add column if not exists provider_refill_id text,
  add column if not exists provider_refill_status text,
  add column if not exists provider_refill_requested_at timestamptz,
  add column if not exists provider_refill_last_status_at timestamptz;

alter table public.orders drop constraint if exists orders_provider_refill_status_check;
alter table public.orders
  add constraint orders_provider_refill_status_check
  check (
    provider_refill_status is null
    or provider_refill_status in (
      'requested', 'pending', 'completed', 'rejected', 'failed', 'unknown'
    )
  );

create unique index if not exists orders_provider_refill_id_uidx
  on public.orders (provider_refill_id)
  where provider_refill_id is not null;

alter table public.jobs drop constraint if exists jobs_task_check;
alter table public.jobs
  add constraint jobs_task_check
  check (task in (
    'fulfill', 'poll_status', 'poll_provider_status', 'purge_rate_limits',
    'email_customer_payment', 'email_owner_payment', 'email_owner_alert',
    'provider_refill', 'poll_refill_status'
  ));

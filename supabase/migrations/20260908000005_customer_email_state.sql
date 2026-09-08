alter table public.orders add column if not exists customer_email_state text not null default 'unknown';

alter table public.orders drop constraint if exists orders_customer_email_state_check;

alter table public.orders add constraint orders_customer_email_state_check check (
  customer_email_state in ('unknown', 'queued', 'sent', 'failed')
);

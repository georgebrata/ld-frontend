-- Minute worker: POST process-jobs with WORKER_SECRET from app_secrets.
-- pg_cron / pg_net are optional; skip locally if the extensions are unavailable.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

create or replace function public.kick_process_jobs()
returns bigint
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  secret text;
  fn_url text;
  req_id bigint;
begin
  select value into secret from public.app_secrets where name = 'WORKER_SECRET';
  select value into fn_url from public.app_secrets where name = 'APP_FUNCTIONS_URL';
  if secret is null or secret = '' or fn_url is null or fn_url = '' then
    return null;
  end if;
  select net.http_post(
    url := rtrim(fn_url, '/') || '/process-jobs',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || secret,
      'X-Worker-Secret', secret
    ),
    body := '{}'::jsonb
  ) into req_id;
  return req_id;
end;
$$;

revoke all on function public.kick_process_jobs() from public, anon, authenticated;
grant execute on function public.kick_process_jobs() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid)
    from cron.job
    where jobname = 'ld-process-jobs';
    perform cron.schedule('ld-process-jobs', '* * * * *', 'select public.kick_process_jobs()');
  end if;
end;
$$;

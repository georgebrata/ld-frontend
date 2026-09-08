-- Daily catalogue refresh: POST refresh-catalogue with WORKER_SECRET from app_secrets.
-- Rewrites catalogue_cache (sp24:services + catalogue:public) from SocialPanel24.

create or replace function public.kick_refresh_catalogue()
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
    url := rtrim(fn_url, '/') || '/refresh-catalogue',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || secret,
      'X-Worker-Secret', secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) into req_id;
  return req_id;
end;
$$;

revoke all on function public.kick_refresh_catalogue() from public, anon, authenticated;
grant execute on function public.kick_refresh_catalogue() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid)
    from cron.job
    where jobname = 'ld-refresh-catalogue';
    perform cron.schedule(
      'ld-refresh-catalogue',
      '0 6 * * *',
      'select public.kick_refresh_catalogue()'
    );
  end if;
end;
$$;

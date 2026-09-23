-- Point live checkout/CORS at the current Vercel origin.
-- Auth Site URL in hosted GoTrue is set separately (Dashboard → Authentication → URL Configuration).

update public.app_secrets
set value = 'https://ld-frontend-phi.vercel.app',
    updated_at = now()
where name = 'SITE_URL';

update public.app_secrets
set value = concat(value, ',https://ld-frontend-phi.vercel.app'),
    updated_at = now()
where name = 'CORS_ALLOW_ORIGINS'
  and position('ld-frontend-phi.vercel.app' in coalesce(value, '')) = 0;

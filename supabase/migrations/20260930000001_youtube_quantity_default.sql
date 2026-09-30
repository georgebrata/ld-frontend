-- Align YouTube Subscribers default with SocialPanel24 minimum (5000).
update public.products
set quantity_default = 5000,
    updated_at = now()
where id = '06';

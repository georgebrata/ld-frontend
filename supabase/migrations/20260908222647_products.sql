-- Normalized storefront products. catalogue_cache stays a TTL blob store.
-- socialpanel_id is server-only; browser roles have no table access.

create table if not exists public.products (
  id text primary key,
  platform text not null,
  platform_label text not null,
  service text not null,
  slug text not null,
  label text not null,
  description text not null default '',
  inputs text[] not null default array['url']::text[],
  visible boolean not null default true,
  socialpanel_id text not null default '',
  rate_unit text not null
    check (rate_unit in ('per_1000', 'per_unit', 'package', 'per_comment')),
  retail_currency text not null default 'USD',
  markup_multiplier numeric not null default 2 check (markup_multiplier >= 1),
  quantity_step integer not null default 1 check (quantity_step >= 1),
  quantity_default integer,
  package_price_minor integer,
  drip_enabled boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_platform_service_unique unique (platform, service),
  constraint products_platform_slug_unique unique (platform, slug)
);

create index if not exists products_visible_sort_idx
  on public.products (visible, sort_order, id);

alter table public.products enable row level security;

revoke all on table public.products from anon, authenticated, public;
grant all on table public.products to service_role;

insert into public.products (
  id, platform, platform_label, service, slug, label, description, inputs, visible,
  socialpanel_id, rate_unit, retail_currency, markup_multiplier, quantity_step,
  quantity_default, package_price_minor, drip_enabled, sort_order
) values
  (
    '01', 'instagram', 'Instagram', 'Likes', 'likes', 'Instagram Likes', '',
    array['url']::text[], true, '11456', 'per_1000', 'USD', 2, 100, 1000, null, false, 10
  ),
  (
    '02', 'instagram', 'Instagram', 'Followers', 'followers', 'Instagram Followers', '',
    array['username']::text[], true, '12472', 'per_1000', 'USD', 2, 100, 1000, null, false, 20
  ),
  (
    '03', 'instagram', 'Instagram', 'Comments', 'comments', 'Instagram Comments', '',
    array['url', 'comments']::text[], true, '12364', 'per_1000', 'USD', 2, 1, null, null, false, 30
  ),
  (
    '04', 'tiktok', 'TikTok', 'Likes', 'likes', 'TikTok Likes', '',
    array['url']::text[], true, '11655', 'per_1000', 'USD', 2, 100, 1000, null, false, 40
  ),
  (
    '05', 'tiktok', 'TikTok', 'Followers', 'followers', 'TikTok Followers', '',
    array['username']::text[], true, '12474', 'per_1000', 'USD', 2, 100, 1000, null, false, 50
  ),
  (
    '06', 'youtube', 'Youtube', 'Subscribers', 'subscribers', 'Youtube Subscribers', '',
    array['url']::text[], true, '12610', 'per_1000', 'USD', 2, 50, 1000, null, false, 60
  ),
  (
    '07', 'instagram', 'Instagram', 'Saves', 'saves', 'Instagram Saves', '',
    array['url']::text[], true, '', 'per_1000', 'USD', 2, 100, 1000, null, false, 35
  );

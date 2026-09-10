import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RETAIL_CATALOGUE } from '../supabase/functions/_shared/retail-catalogue.js';
import { parseInputList } from '../supabase/functions/_shared/inputs.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const SITE_URL = 'https://like-dealer.com';
const SLUG_PATTERN = /^[a-z][a-z0-9-]{0,47}$/;
const RAW_FILL = new Set(['RESOURCE_HINTS', 'MENU', 'HERO_SVG', 'CATALOGUE', 'CONTENT', 'SERVICES_JSON', 'JSON_LD', 'BODY_ATTRS']);
const KNOWN_ICONS = new Set(['instagram', 'tiktok', 'youtube', 'facebook']);
const THEME_COLORS = {
  home: '#52555b',
  instagram: '#d62976',
  tiktok: '#ff005c',
  youtube: '#ff0000',
  facebook: '#4c66a4',
};
const STATIC_PLATFORM_FOLDERS = new Set(['instagram', 'tiktok', 'youtube', 'facebook']);

/**
 * @param {string} value
 * @returns {string}
 */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isVisible(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value == null) return false;
  const normalized = String(value).trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

/**
 * @param {string} platform
 * @returns {string}
 */
function toPlatformSlug(platform) {
  const slug = String(platform ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!SLUG_PATTERN.test(slug)) {
    throw new Error(`Invalid platform slug: ${platform}`);
  }
  return slug;
}

/**
 * @param {string} name
 * @returns {string}
 */
function toServiceSlug(name) {
  const slug = String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!SLUG_PATTERN.test(slug || 'service')) {
    throw new Error(`Invalid service slug: ${name}`);
  }
  return slug || 'service';
}

/**
 * @param {unknown} value
 * @returns {number|null}
 */
function parsePrice(value) {
  if (value == null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num : null;
}

/**
 * @param {string} raw
 * @returns {string[]}
 */
function parseInputs(raw) {
  return parseInputList(raw);
}

/**
 * @param {Record<string, unknown>} row
 */
function normalizeService(row) {
  const platformLabel = String(row.Platform ?? row.platform ?? '').trim();
  const platform = toPlatformSlug(platformLabel);
  const service = String(row.Service ?? row.service ?? '').trim();
  const id = String(row.ID ?? row.id ?? row.serviceId ?? '').trim();

  return {
    id,
    platform,
    platformLabel: platformLabel || platform,
    service,
    label: `${platformLabel} ${service}`.trim(),
    description: String(row.Description ?? row.description ?? '').trim(),
    price: parsePrice(row.Price ?? row.price),
    inputs: parseInputs(row.Inputs ?? row.inputs ?? ''),
    visible: isVisible(row.Visible ?? row.visible),
  };
}

/**
 * @param {ReturnType<typeof normalizeService>[]} services
 */
function assignServiceSlugs(services) {
  /** @type {Map<string, Set<string>>} */
  const used = new Map();

  return services.map((service) => {
    if (!used.has(service.platform)) used.set(service.platform, new Set());
    const taken = used.get(service.platform);
    let slug = toServiceSlug(service.service);

    if (taken.has(slug)) {
      const withId = toServiceSlug(`${service.service}-${service.id}`);
      slug = taken.has(withId) ? `${slug}-${service.id}` : withId;
    }

    taken.add(slug);
    return {
      ...service,
      slug,
      url: `/${service.platform}/${slug}/`,
    };
  });
}

function formatCardPrice(service) {
  if (service.retailRateMinor == null && service.price == null) return 'Price at checkout';
  if (service.rateUnit === 'per_comment') return 'Priced per comment';
  if (service.rateUnit === 'package') return 'Package price at checkout';
  if (service.rateUnit === 'per_1000') return 'Priced per 1,000';
  if (service.price != null) return `$${service.price} per 1k`;
  return 'Price at checkout';
}

/**
 * @param {string} platform
 * @param {string} platformLabel
 */
function platformIconHtml(platform, platformLabel) {
  if (KNOWN_ICONS.has(platform)) {
    return `<img src="/assets/icons/${platform}.svg" alt="${escapeHtml(platformLabel)} logo" />`;
  }
  const initials = escapeHtml(platformLabel.trim().slice(0, 2).toUpperCase());
  return `<span class="platform-badge">${initials}</span>`;
}

/**
 * @param {{ platform: string, platformLabel: string }[]} platforms
 */
function renderHomeCards(platforms) {
  const cards = platforms
    .map(
      (platform) => `<a class="choice-card choice-card--${escapeHtml(platform.platform)} home-card" href="/${platform.platform}/" aria-label="${escapeHtml(platform.platformLabel)} services">
        <span class="choice-card__icon">${platformIconHtml(platform.platform, platform.platformLabel)}</span>
        <span class="choice-card__title">${escapeHtml(platform.platformLabel)}</span>
      </a>`
    )
    .join('\n      ');
  return `<div id="home">\n      ${cards}\n    </div>`;
}

/**
 * @param {Array<{ service: string, platform: string, platformLabel: string, description: string, price: number|null, url: string, label: string }>} services
 */
function renderServiceCards(services) {
  const cards = services
    .map((service) => {
      const meta = service.description || formatCardPrice(service);
      return `<a class="choice-card choice-card--${escapeHtml(service.platform)} service-card" href="${escapeHtml(service.url)}" aria-label="${escapeHtml(service.label)}">
        <span class="choice-card__icon">${platformIconHtml(service.platform, service.platformLabel)}</span>
        <span class="choice-card__title">${escapeHtml(service.service)}</span>
        <span class="choice-card__meta">${escapeHtml(meta)}</span>
      </a>`;
    })
    .join('\n      ');
  return `<div id="services">\n      ${cards}\n    </div>`;
}

/**
 * @param {{ label: string, description: string, price: number|null, platform: string, platformLabel: string }} service
 */
function renderServiceDetail(service) {
  const icon = platformIconHtml(service.platform, service.platformLabel);
  const desc = service.description
    ? `<p class="service-detail__desc">${escapeHtml(service.description)}</p>`
    : '';
  return `<article class="service-detail">
      <div class="service-detail__logo">${icon}</div>
      ${desc}
      <p class="service-detail__price">${escapeHtml(formatCardPrice(service))}</p>
      <p>JavaScript is required for secure Stripe checkout. <a href="mailto:support@like-dealer.com">Contact support</a> if you cannot enable it.</p>
    </article>`;
}

/**
 * @param {{ platform: string, platformLabel: string }[]} platforms
 */
function renderMenu(platforms) {
  const items = [
    ['/', 'Home'],
    ['/why/', 'Why'],
    ...platforms.map((p) => [`/${p.platform}/`, p.platformLabel === 'Youtube' ? 'YouTube' : p.platformLabel]),
    ['/legal/terms/', 'Terms'],
  ];
  return items
    .map(([href, label]) => `<li><a href="${href}" class="menu">${escapeHtml(label)}</a></li>`)
    .join('\n      ');
}

/**
 * @param {'home'|'platform'|'service'} type
 * @param {{ platforms?: { platform: string }[], services?: { url: string, platform: string }[], platform?: string }} opts
 */
function resourceHints(type, opts) {
  /** @type {string[]} */
  const links = [];
  const platform = opts.platform || opts.platforms?.[0]?.platform;
  if (platform && KNOWN_ICONS.has(platform)) {
    links.push(`<link rel="prefetch" href="/assets/icons/${platform}.svg" as="image" />`);
  }
  return links.join('\n  ');
}

/**
 * @param {string} template
 * @param {Record<string, string>} values
 */
function fill(template, values) {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => {
    if (!Object.prototype.hasOwnProperty.call(values, key)) return '';
    const value = values[key] == null ? '' : String(values[key]);
    return RAW_FILL.has(key) ? value : escapeHtml(value);
  });
}

function assertInside(root, target) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(target);
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
    throw new Error(`Refusing to write outside ${resolvedRoot}: ${resolved}`);
  }
}

async function assetVersion() {
  const hash = createHash('sha256');
  const files = ['js/app.js', 'js/ui/scene.js', 'js/order/one-page.js', 'js/checkout/checkout-form.js', 'css/base.css'];
  for (const file of files) {
    hash.update(await readFile(path.join(ROOT, file)));
  }
  return hash.digest('hex').slice(0, 10);
}

async function fetchServices() {
  const sheetUrl = process.env.RETAIL_CATALOGUE_URL;
  const strict = process.env.BUILD_STRICT === '1' || process.env.CI === 'true';
  if (sheetUrl && process.env.BUILD_OFFLINE !== '1') {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const response = await fetch(sheetUrl, { signal: controller.signal });
      clearTimeout(timer);
      const length = Number(response.headers.get('content-length') || 0);
      if (length > 1_000_000) throw new Error('Remote catalogue is too large');
      if (response.ok) {
        const json = await response.json();
        const { adaptSheetCatalogue } = await import('../supabase/functions/_shared/retail-adapter.js');
        const adapted = adaptSheetCatalogue(json);
        if (adapted.length) {
          return assignServiceSlugs(adapted.filter((s) => s.visible && s.platform && s.socialpanelId));
        }
      }
      if (strict) throw new Error(`Retail catalogue URL failed: HTTP ${response.status}`);
    } catch (err) {
      if (strict) throw err;
      console.warn('Retail catalogue URL failed, using bundled catalogue', err instanceof Error ? err.message : err);
    }
  }

  return assignServiceSlugs(
    RETAIL_CATALOGUE.filter((s) => s.visible && s.platform).map((row) => ({
      ...row,
      platformLabel: row.platformLabel === 'Youtube' ? 'YouTube' : row.platformLabel,
      label: `${row.platformLabel === 'Youtube' ? 'YouTube' : row.platformLabel} ${row.service}`.trim(),
      price: null,
      url: `/${row.platform}/${row.service.toLowerCase()}/`,
    }))
  );
}

/**
 * @param {Array<{ platform: string, platformLabel: string }>} services
 */
function uniquePlatforms(services) {
  /** @type {Map<string, { platform: string, platformLabel: string }>} */
  const map = new Map();
  services.forEach((service) => {
    if (!map.has(service.platform)) {
      map.set(service.platform, {
        platform: service.platform,
        platformLabel: service.platformLabel,
      });
    }
  });
  return Array.from(map.values());
}

function snapshotJson(services) {
  const publicServices = services.map(({ socialpanelId, ...service }) => ({
    ...service,
    purchasable: Boolean(socialpanelId),
    enabled: Boolean(service.visible) && Boolean(socialpanelId),
  }));
  return JSON.stringify({ services: publicServices }).replace(/</g, '\\u003c');
}

const TRUST_COPY = `<h2>Don't post into a quiet room.</h2>
      <p>A post with three likes looks unfinished. A profile with eighty followers looks like nobody showed up. LikeDealer is how you buy the opening crowd — likes, followers, comments, saves — so the next person who lands on your content sees momentum instead of crickets. No account. One payment. You keep your passwords.</p>
      <h2>Three moves. Then it starts.</h2>
      <ol>
        <li>Pick a platform</li>
        <li>Pick the signal you want</li>
        <li>Drop your link and pay once with Stripe</li>
      </ol>
      <h2>The price you confirm is the price you pay</h2>
      <p>Card prices are a preview. The real total is calculated on our server at checkout and locked in by Stripe before you pay — no surprise add-ons after you confirm.</p>
      <h2>Your login stays yours</h2>
      <p>We never ask for a social-media password. Stripe handles the card. LikeDealer never sees the number.</p>
      <h2>Pay once. We start the work.</h2>
      <p>A paid order is sent to fulfilment automatically — you do not have to sit on the success page, and landing there is not proof that delivery is finished. Timing depends on the provider and is not guaranteed here. If something goes wrong, support reviews the paid order; a provider cancellation does not refund Stripe by itself.</p>
      <p class="content--why-link"><a class="why-page-link" href="/why/">Why this works →</a></p>`;

/**
 * @param {{ label: string, description: string, price: number|null, url: string }} service
 */
function productJsonLd(service) {
  if (service.price == null) return '';
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: service.label,
    description:
      service.description || `Order ${service.label} from Like Dealer.`,
    url: `${SITE_URL}${service.url}`,
    offers: {
      '@type': 'Offer',
      priceCurrency: 'USD',
      price: String(service.price),
      availability: 'https://schema.org/InStock',
    },
  };
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

function writeSitemap(platforms, services) {
  const urls = [
    { loc: `${SITE_URL}/`, changefreq: 'weekly', priority: '1.0' },
    { loc: `${SITE_URL}/why/`, changefreq: 'monthly', priority: '0.8' },
    ...platforms.map((p) => ({
      loc: `${SITE_URL}/${p.platform}/`,
      changefreq: 'weekly',
      priority: '0.9',
    })),
    ...services
      .filter((s) => s.socialpanelId)
      .map((s) => ({
        loc: `${SITE_URL}${s.url}`,
        changefreq: 'weekly',
        priority: '0.7',
      })),
  ];

  const body = urls
    .map(
      (u) => `  <url>
    <loc>${u.loc}</loc>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;
}

/**
 * @param {string} dir
 * @param {Set<string>} keep
 */
async function removeStaleServiceDirs(dir, keep) {
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && !keep.has(entry.name))
      .map((entry) => rm(path.join(dir, entry.name), { recursive: true, force: true }))
  );
}

async function copyStatic(version) {
  const dirs = ['css', 'js', 'assets', 'favicon', 'why', 'success', 'cancel', 'legal'];
  for (const dir of dirs) {
    const from = path.join(ROOT, dir);
    try {
      await stat(from);
    } catch {
      continue;
    }
    await cp(from, path.join(DIST, dir), { recursive: true });
  }
  for (const file of ['404.html', 'confirmation.html', 'robots.txt', '_headers']) {
    const from = path.join(ROOT, file);
    try {
      await stat(from);
      await cp(from, path.join(DIST, file));
    } catch {
      /* optional */
    }
  }
  const bust = `v=${version}`;
  for (const rel of ['success/index.html', 'cancel/index.html']) {
    const target = path.join(DIST, rel);
    try {
      const html = await readFile(target, 'utf8');
      await writeFile(target, html.replace(/app\.js\?v=[^"']+/g, `app.js?${bust}`));
    } catch {
      /* optional */
    }
  }
}

async function main() {
  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });

  const [shell, heroSvg, version] = await Promise.all([
    readFile(path.join(ROOT, 'templates/shell.html'), 'utf8'),
    readFile(path.join(ROOT, 'templates/hero.svg'), 'utf8'),
    assetVersion(),
  ]);

  const services = await fetchServices();
  const platforms = uniquePlatforms(services);
  const menu = renderMenu(platforms);
  const json = snapshotJson(services);

  await mkdir(path.join(DIST, 'data'), { recursive: true });
  await writeFile(
    path.join(DIST, 'data/services.json'),
    `${JSON.stringify({ services: services.map(({ socialpanelId, ...service }) => service) }, null, 2)}\n`
  );

  const shared = {
    MENU: menu,
    HERO_SVG: heroSvg.trim(),
    CONTENT: TRUST_COPY,
    SERVICES_JSON: json,
    ASSET_VERSION: version,
  };

  const homeHtml = fill(shell, {
    ...shared,
    TITLE: 'Like Dealer — Boost Your Socials',
    CANONICAL: `${SITE_URL}/`,
    DESCRIPTION:
      'Discover our premium social media engagement service designed to skyrocket your reach, engagement, and credibility.',
    OG_TITLE: 'Like Dealer — Boost Your Socials',
    THEME_COLOR: THEME_COLORS.home,
    RESOURCE_HINTS: resourceHints('home', { platforms }),
    BODY_CLASS: 'page-home',
    BODY_ATTRS: 'data-page="home"',
    PAGE_TITLE: 'Boost your socials',
    CATALOGUE: `<noscript>${renderHomeCards(platforms)}</noscript><div class="catalogue-state"><p>Loading services…</p></div>`,
    JSON_LD: '',
  });
  await writeFile(path.join(DIST, 'index.html'), homeHtml);

  for (const platform of platforms) {
    const filtered = services.filter((s) => s.platform === platform.platform);
    const platformDir = path.join(DIST, platform.platform);
    assertInside(DIST, platformDir);
    await mkdir(platformDir, { recursive: true });

    const platformHtml = fill(shell, {
      ...shared,
      TITLE: `${platform.platformLabel} Services | Like Dealer`,
      CANONICAL: `${SITE_URL}/${platform.platform}/`,
      DESCRIPTION: `Buy ${platform.platformLabel} likes, followers, and engagement. Premium services from Like Dealer.`,
      OG_TITLE: `${platform.platformLabel} Services | Like Dealer`,
      THEME_COLOR: THEME_COLORS[platform.platform] ?? THEME_COLORS.home,
      RESOURCE_HINTS: resourceHints('platform', { platform: platform.platform, services: filtered }),
      BODY_CLASS: `platform-${platform.platform}`,
      BODY_ATTRS: `data-page="platform" data-platform="${escapeHtml(platform.platform)}"`,
      PAGE_TITLE: `${platform.platformLabel} services`,
      CATALOGUE: `<noscript>${renderServiceCards(filtered)}</noscript><div class="catalogue-state"><p>Loading services…</p></div>`,
      JSON_LD: '',
    });
    await writeFile(path.join(platformDir, 'index.html'), platformHtml);

    for (const service of filtered) {
      const serviceDir = path.join(platformDir, service.slug);
      assertInside(platformDir, serviceDir);
      await mkdir(serviceDir, { recursive: true });
      const serviceHtml = fill(shell, {
        ...shared,
        TITLE: `${service.label} | Like Dealer`,
        CANONICAL: `${SITE_URL}${service.url}`,
        DESCRIPTION:
          service.description || `Order ${service.label} from Like Dealer. Premium social media engagement.`,
        OG_TITLE: `${service.label} | Like Dealer`,
        THEME_COLOR: THEME_COLORS[service.platform] ?? THEME_COLORS.home,
        RESOURCE_HINTS: resourceHints('service', { platform: service.platform }),
        BODY_CLASS: `platform-${service.platform} page-service`,
        BODY_ATTRS: `data-page="service" data-platform="${escapeHtml(service.platform)}" data-service-id="${escapeHtml(service.id)}"`,
        PAGE_TITLE: service.label,
        CATALOGUE: `<noscript>${renderServiceDetail(service)}</noscript><div class="catalogue-state"><p>Loading checkout…</p></div>`,
        JSON_LD: productJsonLd(service),
      });
      await writeFile(path.join(serviceDir, 'index.html'), serviceHtml);
    }
  }

  await writeFile(path.join(DIST, 'sitemap.xml'), writeSitemap(platforms, services));
  await copyStatic(version);

  if (process.env.BUILD_CHECK === '1') {
    const home = await readFile(path.join(DIST, 'index.html'), 'utf8');
    if (!home.includes('data-page="home"')) throw new Error('build check failed: home page');
    if (home.includes('cdn.jsdelivr.net')) throw new Error('build check failed: jsDelivr in dist');
    const headers = await readFile(path.join(DIST, '_headers'), 'utf8');
    if (!headers.includes('X-Content-Type-Options')) throw new Error('build check failed: _headers');
  }

  console.log(`Built dist/ with ${platforms.length} platform page(s) and ${services.length} service page(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

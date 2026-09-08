import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RETAIL_CATALOGUE } from '../supabase/functions/_shared/retail-catalogue.js';
import { parseInputList } from '../supabase/functions/_shared/inputs.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE_URL = 'https://like-dealer.com';
const TAGLINE = 'Boost your socials';
const KNOWN_ICONS = new Set(['instagram', 'tiktok', 'youtube', 'facebook']);
const THEME_COLORS = {
  home: '#52555b',
  instagram: '#d62976',
  tiktok: '#ff005c',
  youtube: '#ff0000',
  facebook: '#4c66a4',
};
const CARD_SVG_PATH =
  'M604 0l12681 0c332,0 604,272 604,604l0 18237c0,332 -272,603 -604,603l-12681 0c-332,0 -604,-271 -604,-603l0 -18237c0,-332 272,-604 604,-604zm4546 1389l1100 0c0,-384 311,-695 695,-695 383,0 694,311 694,695l1100 0c222,0 404,182 404,405l0 0c0,223 -182,405 -404,405l-3589 0c-222,0 -405,-182 -405,-405l0 0c0,-223 183,-405 405,-405z';
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
  return String(platform ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
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

function cardFrameSvg() {
  return `<svg width="100%" height="100%" viewBox="0 0 13889 19444" style="fill:#fff" aria-hidden="true"><g><path class="svgcolor" d="${CARD_SVG_PATH}"></path></g></svg>`;
}

/**
 * @param {string} platform
 * @param {string} platformLabel
 */
function platformIconHtml(platform, platformLabel) {
  if (KNOWN_ICONS.has(platform)) {
    return `<img src="/assets/cardLogos/${platform}.svg" alt="${escapeHtml(platformLabel)} logo" width="70%" />`;
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
      (platform) => `<a class="home-card" href="/${platform.platform}/" aria-label="${escapeHtml(platform.platformLabel)} services">
        <div class="home-card-front">
          ${cardFrameSvg()}
          <div class="home-card-logo">${platformIconHtml(platform.platform, platform.platformLabel)}</div>
        </div>
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
      const icon = KNOWN_ICONS.has(service.platform)
        ? `<img src="/assets/cardLogos/${service.platform}.svg" alt="${escapeHtml(service.platformLabel)} logo" />`
        : `<span class="platform-badge">${escapeHtml(service.platformLabel.trim().slice(0, 2).toUpperCase())}</span>`;
      const desc = service.description
        ? `<p class="service-card-desc">${escapeHtml(service.description)}</p>`
        : '';
      return `<a class="gcard service-card" href="${escapeHtml(service.url)}" aria-label="${escapeHtml(service.label)}">
        <div class="gcard-front service-card-front">
          ${cardFrameSvg()}
          <div class="gcard-logo service-card-logo">
            <div class="service-title gcard-value gcard-type service-card-type"><p>${escapeHtml(service.service)}</p></div>
            ${icon}
            ${desc}
            <div class="service-title gcard-value service-card-value"><p>${escapeHtml(formatCardPrice(service))}</p></div>
          </div>
        </div>
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
      <button type="button" class="btn" data-checkout-trigger>Order ${escapeHtml(service.label)}</button>
    </article>`;
}

/**
 * @param {{ platform: string, platformLabel: string }[]} platforms
 */
function renderMenu(platforms) {
  const items = [
    ['/', 'Home'],
    ['/why/', 'Why'],
    ...platforms.map((p) => [`/?platform=${p.platform}`, p.platformLabel]),
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

  if (type === 'home') {
    for (const platform of opts.platforms ?? []) {
      links.push(`<link rel="prefetch" href="/${platform.platform}/" />`);
      if (KNOWN_ICONS.has(platform.platform)) {
        links.push(`<link rel="prefetch" href="/assets/cardLogos/${platform.platform}.svg" as="image" />`);
      }
    }
  }

  if (type === 'platform' && opts.platform) {
    if (KNOWN_ICONS.has(opts.platform)) {
      links.push(`<link rel="prefetch" href="/assets/cardLogos/${opts.platform}.svg" as="image" />`);
    }
    for (const service of (opts.services ?? []).filter((s) => s.platform === opts.platform)) {
      links.push(`<link rel="prefetch" href="${escapeHtml(service.url)}" />`);
    }
  }

  if (type === 'service' && opts.platform) {
    links.push(`<link rel="prefetch" href="/${opts.platform}/" />`);
    if (KNOWN_ICONS.has(opts.platform)) {
      links.push(`<link rel="prefetch" href="/assets/cardLogos/${opts.platform}.svg" as="image" />`);
    }
  }

  return links.join('\n  ');
}

/**
 * @param {string} template
 * @param {Record<string, string>} values
 */
function fill(template, values) {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (_, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key] : ''
  );
}

async function fetchServices() {
  const sheetUrl = process.env.RETAIL_CATALOGUE_URL;
  if (sheetUrl) {
    try {
      const response = await fetch(sheetUrl);
      if (response.ok) {
        const json = await response.json();
        const { adaptSheetCatalogue } = await import('../supabase/functions/_shared/retail-adapter.js');
        const adapted = adaptSheetCatalogue(json);
        if (adapted.length) {
          return assignServiceSlugs(adapted.filter((s) => s.visible && s.platform));
        }
      }
    } catch (err) {
      console.warn('Retail catalogue URL failed, using bundled catalogue', err instanceof Error ? err.message : err);
    }
  }

  return assignServiceSlugs(
    RETAIL_CATALOGUE.filter((s) => s.visible && s.platform).map((row) => ({
      ...row,
      label: `${row.platformLabel} ${row.service}`.trim(),
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
  const phrases = [TAGLINE, ...services.map((s) => s.label).filter(Boolean)];
  const publicServices = services.map(({ socialpanelId, ...service }) => ({
    ...service,
    purchasable: false,
    enabled: Boolean(service.visible),
  }));
  return JSON.stringify({ services: publicServices, phrases }).replace(/</g, '\\u003c');
}

const TRUST_COPY = `<h2>What LikeDealer is</h2>
      <p>LikeDealer is a simple way to buy social-media engagement. You do not need an account. Pick a platform, choose a service, and pay once.</p>
      <h2>How this page works</h2>
      <ol>
        <li>Choose a platform</li>
        <li>Choose a service</li>
        <li>Enter the required details and pay securely with Stripe</li>
      </ol>
      <h2>Pricing</h2>
      <p>Any price shown on a card is guidance. The amount you pay is calculated on the server at checkout and confirmed by Stripe.</p>
      <h2>Secure payment</h2>
      <p>Payments are processed by Stripe. LikeDealer never sees your card number. We never ask for social-media passwords.</p>
      <h2>After you pay</h2>
      <p>Paid orders are submitted to the fulfilment provider automatically. Reaching the success page is not required for that work, and it is not proof that delivery is finished. Refunds are handled by support after review — a provider cancellation does not itself refund Stripe.</p>`;

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
    ...services.map((s) => ({
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

async function main() {
  const [shell, heroSvg] = await Promise.all([
    readFile(path.join(ROOT, 'templates/shell.html'), 'utf8'),
    readFile(path.join(ROOT, 'templates/hero.svg'), 'utf8'),
  ]);

  const services = await fetchServices();
  const platforms = uniquePlatforms(services);
  const menu = renderMenu(platforms);
  const json = snapshotJson(services);

  await mkdir(path.join(ROOT, 'data'), { recursive: true });
  await writeFile(
    path.join(ROOT, 'data/services.json'),
    `${JSON.stringify({ services: services.map(({ socialpanelId, ...service }) => service) }, null, 2)}\n`
  );

  const homeHtml = fill(shell, {
    TITLE: 'Like Dealer — Boost Your Socials',
    CANONICAL: `${SITE_URL}/`,
    DESCRIPTION:
      'Discover our premium social media engagement service designed to skyrocket your reach, engagement, and credibility.',
    OG_TITLE: 'Like Dealer — Boost Your Socials',
    THEME_COLOR: THEME_COLORS.home,
    RESOURCE_HINTS: resourceHints('home', { platforms }),
    BODY_CLASS: 'page-home',
    BODY_ATTRS: 'data-page="home"',
    MENU: menu,
    HERO_SVG: heroSvg.trim(),
    PAGE_TITLE: 'Boost your socials',
    CATALOGUE: `<noscript>${renderHomeCards(platforms)}</noscript><div class="catalogue-state"><p>Loading services…</p></div>`,
    CONTENT: TRUST_COPY,
    SERVICES_JSON: json,
    JSON_LD: '',
  });
  await writeFile(path.join(ROOT, 'index.html'), homeHtml);

  const generatedPlatforms = new Set(platforms.map((p) => p.platform));

  for (const platform of platforms) {
    const filtered = services.filter((s) => s.platform === platform.platform);
    const platformDir = path.join(ROOT, platform.platform);
    await mkdir(platformDir, { recursive: true });

    const platformHtml = fill(shell, {
      TITLE: `${platform.platformLabel} Services | Like Dealer`,
      CANONICAL: `${SITE_URL}/${platform.platform}/`,
      DESCRIPTION: `Buy ${platform.platformLabel} likes, followers, and engagement. Premium services from Like Dealer.`,
      OG_TITLE: `${platform.platformLabel} Services | Like Dealer`,
      THEME_COLOR: THEME_COLORS[platform.platform] ?? THEME_COLORS.home,
      RESOURCE_HINTS: resourceHints('platform', { platform: platform.platform, services: filtered }),
      BODY_CLASS: `platform-${platform.platform}`,
      BODY_ATTRS: `data-page="platform" data-platform="${escapeHtml(platform.platform)}"`,
      MENU: menu,
      HERO_SVG: heroSvg.trim(),
      PAGE_TITLE: `${platform.platformLabel} services`,
      CATALOGUE: `<noscript>${renderServiceCards(filtered)}</noscript><div class="catalogue-state"><p>Loading services…</p></div>`,
      CONTENT: TRUST_COPY,
      SERVICES_JSON: json,
      JSON_LD: '',
    });
    await writeFile(path.join(platformDir, 'index.html'), platformHtml);

    const slugs = new Set(filtered.map((s) => s.slug));
    await removeStaleServiceDirs(platformDir, slugs);

    for (const service of filtered) {
      const serviceDir = path.join(platformDir, service.slug);
      await mkdir(serviceDir, { recursive: true });
      const serviceHtml = fill(shell, {
        TITLE: `${service.label} | Like Dealer`,
        CANONICAL: `${SITE_URL}${service.url}`,
        DESCRIPTION:
          service.description ||
          `Order ${service.label} from Like Dealer. Premium social media engagement.`,
        OG_TITLE: `${service.label} | Like Dealer`,
        THEME_COLOR: THEME_COLORS[service.platform] ?? THEME_COLORS.home,
        RESOURCE_HINTS: resourceHints('service', { platform: service.platform }),
        BODY_CLASS: `platform-${service.platform} page-service`,
        BODY_ATTRS: `data-page="service" data-platform="${escapeHtml(service.platform)}" data-service-id="${escapeHtml(service.id)}"`,
        MENU: menu,
        HERO_SVG: heroSvg.trim(),
        PAGE_TITLE: service.label,
        CATALOGUE: `<noscript>${renderServiceDetail(service)}</noscript><div class="catalogue-state"><p>Loading checkout…</p></div>`,
        CONTENT: TRUST_COPY,
        SERVICES_JSON: json,
        JSON_LD: productJsonLd(service),
      });
      await writeFile(path.join(serviceDir, 'index.html'), serviceHtml);
    }
  }

  for (const folder of STATIC_PLATFORM_FOLDERS) {
    if (!generatedPlatforms.has(folder)) {
      await rm(path.join(ROOT, folder), { recursive: true, force: true });
    }
  }

  await writeFile(path.join(ROOT, 'sitemap.xml'), writeSitemap(platforms, services));

  console.log(
    `Built home, ${platforms.length} platform page(s), and ${services.length} service page(s).`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

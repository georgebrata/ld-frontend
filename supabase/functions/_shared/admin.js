/**
 * Admin catalogue console. JWT + admin_users allowlist; product writes stay
 * on the service-role store. Prices are still computed only via joinService.
 */

import { STOREFRONT_INPUTS, canonicalInputName, parseInputList } from './inputs.js';
import { productRowToRetail } from './retail-adapter.js';
import {
  getProviderCatalog,
  joinService,
  pricingEnv,
  refreshCatalogue,
} from './catalogue.js';
import { findProviderService } from './pricing.js';
import { getProviderType, isSupportedProviderType } from './provider-types.js';

export const ADMIN_REGISTERED_FLAG = 'ADMIN_REGISTERED';
export const SLUG_PATTERN = /^[a-z][a-z0-9-]{0,47}$/;
export const PRODUCT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,47}$/;
export const RATE_UNITS = Object.freeze(['per_1000', 'per_unit', 'package', 'per_comment']);

const PUBLIC_ACTIONS = new Set(['bootstrap', 'register']);
const AUTH_ACTIONS = new Set([
  'products.list',
  'products.preview',
  'products.upsert',
  'products.delete',
  'products.reorder',
  'provider.services',
  'catalogue.refresh',
]);

const PLATFORM_HINTS = [
  { platform: 'instagram', label: 'Instagram', match: /instagram/i },
  { platform: 'tiktok', label: 'TikTok', match: /tiktok/i },
  { platform: 'youtube', label: 'YouTube', match: /youtube/i },
  { platform: 'facebook', label: 'Facebook', match: /facebook/i },
];

/**
 * @param {{ headers?: { get: (name: string) => string|null } }|null|undefined} request
 */
export function readBearerToken(request) {
  const header = request?.headers?.get?.('Authorization') || request?.headers?.get?.('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

/**
 * @param {string} email
 */
function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

/**
 * @param {unknown} err
 */
function isUniqueViolation(err) {
  return Boolean(err && /** @type {{ code?: string }} */ (err).code === '23505');
}

/**
 * @param {Array<{ id?: string }>} existing
 */
export function nextProductId(existing) {
  const nums = (existing || [])
    .map((row) => Number(row.id))
    .filter((value) => Number.isInteger(value) && value >= 0);
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return String(next).padStart(2, '0');
}

/**
 * @param {unknown} value
 */
function asBoolean(value, fallback = true) {
  if (value === true || value === false) return value;
  if (value == null || value === '') return fallback;
  const text = String(value).trim().toLowerCase();
  if (text === 'true' || text === '1' || text === 'yes') return true;
  if (text === 'false' || text === '0' || text === 'no') return false;
  return fallback;
}

/**
 * @param {unknown} value
 * @param {number|null} fallback
 */
function asNullableInt(value, fallback = null) {
  if (value == null || value === '') return fallback;
  const num = Number(value);
  return Number.isInteger(num) ? num : NaN;
}

/**
 * @param {Record<string, unknown>} input
 * @param {{ existing?: any[], isUpdate?: boolean, preview?: boolean }} [options]
 */
export function validateProductPayload(input, options = {}) {
  const errors = [];
  const existing = Array.isArray(options.existing) ? options.existing : [];
  const row = input && typeof input === 'object' ? input : {};

  let id = String(row.id ?? '').trim();
  if (!id) {
    if (options.isUpdate) errors.push('Product id is required.');
    else id = nextProductId(existing);
  } else if (!PRODUCT_ID_PATTERN.test(id)) {
    errors.push('Invalid product id.');
  }

  const platform = String(row.platform ?? '')
    .trim()
    .toLowerCase();
  if (!SLUG_PATTERN.test(platform)) errors.push('Invalid platform slug.');

  const slug = String(row.slug ?? '')
    .trim()
    .toLowerCase();
  if (!SLUG_PATTERN.test(slug) || slug.includes('..')) errors.push('Invalid slug.');

  const service = String(row.service ?? '').trim();
  if (!service || service.length > 80) errors.push('Service name is required.');

  const platformLabel = String(row.platformLabel ?? row.platform_label ?? '').trim();
  if (!platformLabel) errors.push('Platform label is required.');

  const label = String(row.label ?? '').trim() || `${platformLabel} ${service}`.trim();
  const description = String(row.description ?? '');

  const rateUnit = String(row.rateUnit ?? row.rate_unit ?? '').trim();
  if (!RATE_UNITS.includes(rateUnit)) errors.push('Invalid rate unit.');

  const markup = Number(row.markupMultiplier ?? row.markup_multiplier ?? 2);
  if (!Number.isFinite(markup) || markup < 1) errors.push('Markup must be at least 1.');

  const step = Number(row.quantityStep ?? row.quantity_step ?? 1);
  if (!Number.isInteger(step) || step < 1) errors.push('Quantity step must be an integer ≥ 1.');

  const rawInputs = Array.isArray(row.inputs) ? row.inputs : parseInputList(row.inputs);
  for (const name of rawInputs) {
    const canonical = canonicalInputName(name);
    if (!canonical || !STOREFRONT_INPUTS.includes(canonical)) {
      errors.push(`Unknown input name: ${name}`);
    }
  }
  const inputs = parseInputList(rawInputs.length ? rawInputs : ['url']);

  const quantityDefault = asNullableInt(row.quantityDefault ?? row.quantity_default, null);
  if (Number.isNaN(quantityDefault)) errors.push('Quantity default must be an integer.');

  const packagePriceMinor = asNullableInt(row.packagePriceMinor ?? row.package_price_minor, null);
  if (Number.isNaN(packagePriceMinor) || (packagePriceMinor != null && packagePriceMinor < 0)) {
    errors.push('Package price must be a non-negative integer.');
  }

  const minContributionMinor = asNullableInt(row.minContributionMinor ?? row.min_contribution_minor, 30);
  if (!Number.isInteger(minContributionMinor) || minContributionMinor < 0) {
    errors.push('Minimum contribution must be a non-negative integer.');
  }

  const sortOrder = asNullableInt(row.sortOrder ?? row.sort_order, 0);
  if (!Number.isInteger(sortOrder)) errors.push('Sort order must be an integer.');

  const currency = String(row.retailCurrency ?? row.retail_currency ?? 'USD')
    .trim()
    .toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) errors.push('Invalid currency.');

  const socialpanelId = String(row.socialpanelId ?? row.socialpanel_id ?? '').trim();

  if (!options.preview && id && platform && service && slug) {
    for (const other of existing) {
      if (other.id === id) continue;
      if (other.platform === platform && other.service === service) {
        errors.push('A product with this platform and service already exists.');
      }
      if (other.platform === platform && other.slug === slug) {
        errors.push('A product with this platform and slug already exists.');
      }
    }
  }

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    value: {
      id,
      platform,
      platform_label: platformLabel,
      service,
      slug,
      label,
      description,
      inputs,
      visible: asBoolean(row.visible, true),
      socialpanel_id: socialpanelId,
      rate_unit: rateUnit,
      retail_currency: currency,
      markup_multiplier: markup,
      quantity_step: step,
      quantity_default: quantityDefault,
      package_price_minor: packagePriceMinor,
      drip_enabled: asBoolean(row.dripEnabled ?? row.drip_enabled, false),
      sort_order: sortOrder ?? 0,
      min_contribution_minor: minContributionMinor,
    },
  };
}

/**
 * @param {string} haystack
 */
export function guessPlatform(haystack) {
  const text = String(haystack || '');
  const hit = PLATFORM_HINTS.find((entry) => entry.match.test(text));
  return hit || { platform: '', label: '' };
}

/**
 * @param {object} provider
 */
export function suggestProductFromProvider(provider) {
  const handler = getProviderType(provider?.type);
  const guessed = guessPlatform(`${provider?.category || ''} ${provider?.name || ''}`);
  const rawName = String(provider?.name || '').trim();
  const stripped = guessed.label
    ? rawName.replace(new RegExp(`^${guessed.label}\\s+`, 'i'), '').trim()
    : rawName;
  const service = stripped || rawName || 'Service';
  const slug = service
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'service';
  const quantityMode = handler?.quantityMode || 'required';
  const rateUnit =
    quantityMode === 'package' ? 'package' : quantityMode === 'from_comments' ? 'per_comment' : 'per_1000';
  const min = Number(provider?.min);
  return {
    platform: guessed.platform,
    platformLabel: guessed.label,
    service,
    slug,
    label: `${guessed.label} ${service}`.trim(),
    description: rawName,
    inputs: handler?.storefrontInputs || ['url'],
    socialpanelId: String(provider?.service ?? ''),
    rateUnit,
    quantityStep: 1,
    quantityDefault: quantityMode === 'from_comments' ? null : Number.isInteger(min) && min > 0 ? min : 1000,
    markupMultiplier: 2,
    visible: true,
    dripEnabled: false,
    typeEnabled: Boolean(handler && handler.enabled),
    quantityMode,
  };
}

/**
 * @param {object} provider
 */
function toAdminProvider(provider) {
  const handler = getProviderType(provider?.type);
  return {
    service: String(provider?.service ?? ''),
    name: String(provider?.name || ''),
    type: String(provider?.type || ''),
    category: String(provider?.category || ''),
    rate: String(provider?.rate || ''),
    min: provider?.min ?? null,
    max: provider?.max ?? null,
    refill: Boolean(provider?.refill),
    cancel: Boolean(provider?.cancel),
    typeEnabled: Boolean(handler && handler.enabled),
    quantityMode: handler?.quantityMode || 'required',
    storefrontInputs: handler?.storefrontInputs || ['url'],
    suggested: suggestProductFromProvider(provider),
  };
}

/**
 * @param {Record<string, unknown>} row
 * @param {ReturnType<typeof joinService>|null} joined
 * @param {object|null} provider
 */
function toAdminProduct(row, joined, provider) {
  return {
    id: row.id,
    platform: row.platform,
    platformLabel: row.platform_label,
    service: row.service,
    slug: row.slug,
    label: row.label,
    description: row.description,
    inputs: row.inputs || [],
    visible: Boolean(row.visible),
    socialpanelId: row.socialpanel_id || '',
    rateUnit: row.rate_unit,
    retailCurrency: row.retail_currency,
    markupMultiplier: Number(row.markup_multiplier),
    quantityStep: row.quantity_step,
    quantityDefault: row.quantity_default,
    packagePriceMinor: row.package_price_minor,
    dripEnabled: Boolean(row.drip_enabled),
    sortOrder: row.sort_order,
    minContributionMinor: row.min_contribution_minor,
    disableReason: joined?.disableReason || '',
    purchasable: Boolean(joined?.purchasable),
    enabled: Boolean(joined?.enabled),
    quantityMode: joined?.quantityMode || '',
    retailRateMinor: joined?.retailRateMinor ?? null,
    currency: joined?.currency || row.retail_currency,
    providerName: provider?.name || '',
    providerType: provider?.type || joined?.providerType || '',
    providerRate: provider?.rate || joined?.providerRate || '',
    providerMin: provider?.min ?? joined?.providerMin ?? null,
    providerMax: provider?.max ?? joined?.providerMax ?? null,
    providerCategory: provider?.category || '',
    typeSupported: provider ? isSupportedProviderType(provider.type) : false,
    refill: Boolean(provider?.refill),
    cancel: Boolean(provider?.cancel),
    updatedAt: row.updated_at || null,
  };
}

function catalogueDeps(env, store, extras) {
  return {
    fetchImpl: extras.fetchImpl,
    now: extras.now,
    cacheGet: (key) => store.cacheGet(key),
    cacheSet: (key, value, ttl) => store.cacheSet(key, value, ttl),
    listProducts: () => store.listProducts(),
  };
}

async function loadProviderRows(env, store, extras) {
  try {
    return { rows: await getProviderCatalog(env, catalogueDeps(env, store, extras)), error: '' };
  } catch (err) {
    let rows = [];
    const stale = await store.cacheGet('sp24:services');
    if (stale && Array.isArray(stale.services)) rows = stale.services;
    return { rows, error: err instanceof Error ? err.message : 'provider_unavailable' };
  }
}

function joinRow(row, providerRows, money) {
  const retail = productRowToRetail(row, {
    defaultCurrency: money.retailCurrency,
    defaultMarkup: money.defaultMarkup,
  });
  const provider = retail ? findProviderService(providerRows, retail.socialpanelId) : null;
  const joined = retail ? joinService(retail, provider, money) : null;
  return { joined, provider };
}

async function getUserFromClient(client, token) {
  if (!token || !client?.auth?.getUser) return null;
  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user) return null;
  return { id: data.user.id, email: data.user.email || '' };
}

async function createUserFromClient(client, { email, password }) {
  if (!client?.auth?.admin?.createUser) {
    throw new Error('Auth admin API is not available.');
  }
  const { data, error } = await client.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) {
    const err = new Error(error.message || 'Could not create user.');
    err.code = error.code || error.status;
    throw err;
  }
  return { id: data.user.id, email: data.user.email || email };
}

async function findUserByEmailFromClient(client, email) {
  if (typeof client?.auth?.admin?.listUsers !== 'function') return null;
  const wanted = normalizeEmail(email);
  const { data, error } = await client.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error || !Array.isArray(data?.users)) return null;
  const hit = data.users.find((row) => normalizeEmail(row?.email) === wanted);
  return hit?.id ? { id: hit.id, email: hit.email || email } : null;
}

/**
 * First signed-in user while ADMIN_REGISTERED is open becomes the allowlisted admin.
 * Heals Auth users created when register ran before admin_users existed.
 * @param {object} store
 * @param {{ id: string, email?: string }} user
 */
async function claimFirstAdmin(store, user) {
  const email = normalizeEmail(user.email);
  if (!user?.id || !isValidEmail(email)) return { ok: false };
  const flag = await store.getFlag(ADMIN_REGISTERED_FLAG);
  if (!flag?.enabled) return { ok: false };
  if ((await store.countAdmins()) > 0) return { ok: false };
  try {
    const row = await store.insertAdminUser({ user_id: user.id, email, role: 'admin' });
    await store.setFlag(ADMIN_REGISTERED_FLAG, false);
    return { ok: true, admin: row };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const existing = await store.getAdminUser(user.id);
    if (existing && !existing.disabled_at) return { ok: true, admin: existing };
    return { ok: false };
  }
}

/**
 * @param {object} store
 * @param {{ headers?: { get: (name: string) => string|null } }} request
 * @param {{ getUser?: Function, client?: object }} extras
 */
export async function requireAdmin(store, request, extras = {}) {
  const token = readBearerToken(request);
  if (!token) return { ok: false, status: 401, error: 'Unauthorized.' };
  const getUser = extras.getUser || ((value) => getUserFromClient(extras.client, value));
  let user;
  try {
    user = await getUser(token);
  } catch {
    return { ok: false, status: 401, error: 'Unauthorized.' };
  }
  if (!user?.id) return { ok: false, status: 401, error: 'Unauthorized.' };
  let row = await store.getAdminUser(user.id);
  if (!row || row.disabled_at) {
    const claimed = await claimFirstAdmin(store, user);
    if (claimed.ok) row = claimed.admin;
  }
  if (!row || row.disabled_at) return { ok: false, status: 403, error: 'Forbidden.' };
  return { ok: true, user: { id: user.id, email: user.email || row.email }, admin: row };
}

async function rateLimit(store, extras, action) {
  if (typeof store.consumeRateLimit !== 'function') return { allowed: true };
  const ip = extras.ip || 'unknown';
  const publicAction = PUBLIC_ACTIONS.has(action);
  const bucket = publicAction ? (action === 'register' ? 'admin-register' : 'admin-public') : 'admin';
  const limit = action === 'register' ? 5 : publicAction ? 30 : 60;
  const windowSec = action === 'register' ? 300 : 60;
  return store.consumeRateLimit(bucket, ip, limit, windowSec);
}

async function handleBootstrap(store) {
  const flag = await store.getFlag(ADMIN_REGISTERED_FLAG);
  const count = await store.countAdmins();
  return {
    status: 200,
    body: {
      ok: true,
      registerOpen: Boolean(flag?.enabled) && count === 0,
    },
  };
}

async function handleRegister(store, body, extras) {
  const flag = await store.getFlag(ADMIN_REGISTERED_FLAG);
  if (!flag?.enabled) return { status: 403, body: { ok: false, error: 'Registration is closed.' } };
  const count = await store.countAdmins();
  if (count > 0) return { status: 403, body: { ok: false, error: 'Registration is closed.' } };

  const email = normalizeEmail(body.email);
  const password = String(body.password || '');
  if (!isValidEmail(email)) return { status: 400, body: { ok: false, error: 'Invalid email.' } };
  if (password.length < 12 || password.length > 72) {
    return { status: 400, body: { ok: false, error: 'Password must be 12–72 characters.' } };
  }

  const createUser = extras.createUser || ((payload) => createUserFromClient(extras.client, payload));
  const findUser = extras.findUser || ((value) => findUserByEmailFromClient(extras.client, value));
  let user;
  try {
    user = await createUser({ email, password });
  } catch (err) {
    if (isUniqueViolation(err) || /already/i.test(err instanceof Error ? err.message : '')) {
      try {
        user = await findUser(email);
      } catch {
        user = null;
      }
      if (!user?.id) return { status: 409, body: { ok: false, error: 'That email is already registered.' } };
    } else {
      return { status: 500, body: { ok: false, error: 'Could not create admin.' } };
    }
  }
  if (!user?.id) return { status: 500, body: { ok: false, error: 'Could not create admin.' } };

  const stillOpen = await store.getFlag(ADMIN_REGISTERED_FLAG);
  const stillEmpty = await store.countAdmins();
  if (!stillOpen?.enabled || stillEmpty > 0) {
    return { status: 403, body: { ok: false, error: 'Registration is closed.' } };
  }

  try {
    await store.insertAdminUser({ user_id: user.id, email, role: 'admin' });
    await store.setFlag(ADMIN_REGISTERED_FLAG, false);
  } catch (err) {
    if (isUniqueViolation(err)) return { status: 403, body: { ok: false, error: 'Registration is closed.' } };
    throw err;
  }

  return { status: 201, body: { ok: true, registerOpen: false } };
}

async function handleProductsList(env, store, extras) {
  const money = pricingEnv(env);
  const rows = await store.listProducts();
  const provider = await loadProviderRows(env, store, extras);
  const products = rows.map((row) => {
    const joined = joinRow(row, provider.rows, money);
    return toAdminProduct(row, joined.joined, joined.provider);
  });
  return {
    status: 200,
    body: {
      ok: true,
      products,
      providerError: provider.error || '',
      providerCount: provider.rows.length,
    },
  };
}

async function handleProductsPreview(env, store, body, extras) {
  const existing = await store.listProducts();
  const validated = validateProductPayload(body.product || body, { existing, preview: true });
  if (!validated.ok) return { status: 400, body: { ok: false, error: validated.errors[0], errors: validated.errors } };
  const money = pricingEnv(env);
  const provider = await loadProviderRows(env, store, extras);
  const joined = joinRow(validated.value, provider.rows, money);
  return {
    status: 200,
    body: {
      ok: true,
      product: toAdminProduct(validated.value, joined.joined, joined.provider),
      providerError: provider.error || '',
    },
  };
}

async function handleProductsUpsert(env, store, body, actor, extras) {
  const existing = await store.listProducts();
  const currentId = String(body.product?.id || body.id || '').trim();
  const isUpdate = Boolean(currentId && existing.some((row) => row.id === currentId));
  const validated = validateProductPayload(body.product || body, { existing, isUpdate });
  if (!validated.ok) return { status: 400, body: { ok: false, error: validated.errors[0], errors: validated.errors } };

  const before = isUpdate ? existing.find((row) => row.id === validated.value.id) : null;
  let saved;
  try {
    saved = await store.upsertProduct(validated.value);
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { status: 409, body: { ok: false, error: 'A product with this platform, service, or slug already exists.' } };
    }
    throw err;
  }
  await store.insertProductAudit({
    actor_user_id: actor.id,
    actor_email: actor.email,
    action: isUpdate ? 'update' : 'create',
    product_id: saved.id,
    before: before || null,
    after: saved,
  });
  const money = pricingEnv(env);
  const provider = await loadProviderRows(env, store, extras);
  const joined = joinRow(saved, provider.rows, money);
  return {
    status: isUpdate ? 200 : 201,
    body: { ok: true, created: !isUpdate, product: toAdminProduct(saved, joined.joined, joined.provider) },
  };
}

async function handleProductsDelete(store, body, actor) {
  const id = String(body.id || body.productId || '').trim();
  if (!id) return { status: 400, body: { ok: false, error: 'Product id is required.' } };
  const existing = typeof store.getProduct === 'function' ? await store.getProduct(id) : (await store.listProducts()).find((row) => row.id === id);
  if (!existing) return { status: 404, body: { ok: false, error: 'Product not found.' } };
  await store.deleteProduct(id);
  await store.insertProductAudit({
    actor_user_id: actor.id,
    actor_email: actor.email,
    action: 'delete',
    product_id: id,
    before: existing,
    after: null,
  });
  return { status: 200, body: { ok: true, id } };
}

async function handleProductsReorder(store, body, actor) {
  const ids = Array.isArray(body.ids) ? body.ids.map((id) => String(id)) : [];
  if (!ids.length) return { status: 400, body: { ok: false, error: 'ids is required.' } };
  const existing = await store.listProducts();
  const known = new Set(existing.map((row) => row.id));
  if (ids.some((id) => !known.has(id))) return { status: 400, body: { ok: false, error: 'Unknown product id.' } };
  const items = ids.map((id, index) => ({ id, sort_order: (index + 1) * 10 }));
  await store.bulkUpdateSortOrder(items);
  await store.insertProductAudit({
    actor_user_id: actor.id,
    actor_email: actor.email,
    action: 'reorder',
    product_id: null,
    before: existing.map((row) => ({ id: row.id, sort_order: row.sort_order })),
    after: items,
  });
  return { status: 200, body: { ok: true, ids } };
}

async function handleProviderServices(env, store, extras) {
  const provider = await loadProviderRows(env, store, extras);
  return {
    status: 200,
    body: {
      ok: true,
      services: provider.rows.map(toAdminProvider),
      providerError: provider.error || '',
    },
  };
}

async function handleCatalogueRefresh(env, store, actor, extras) {
  const result = await refreshCatalogue(env, catalogueDeps(env, store, extras));
  await store.insertProductAudit({
    actor_user_id: actor.id,
    actor_email: actor.email,
    action: 'refresh',
    product_id: null,
    before: null,
    after: {
      ok: result.ok,
      providerCount: result.providerCount,
      purchasable: result.purchasable,
      unmapped: result.unmapped,
      missing: result.missing,
    },
  });
  return { status: result.ok ? 200 : 503, body: { ...result } };
}

/**
 * @param {{ env: object, store: object, client?: object }} ctx
 * @param {Record<string, unknown>} body
 * @param {{
 *   request?: { headers?: { get: (name: string) => string|null } },
 *   ip?: string,
 *   fetchImpl?: typeof fetch,
 *   now?: () => number,
 *   getUser?: (token: string) => Promise<{ id: string, email?: string }|null>,
 *   createUser?: (payload: { email: string, password: string }) => Promise<{ id: string, email?: string }>
 * }} [extras]
 */
export async function handleAdminAction(ctx, body, extras = {}) {
  const action = String(body?.action || '').trim();
  const store = ctx.store;
  const env = ctx.env || {};
  const merged = { ...extras, client: extras.client || ctx.client };

  if (!PUBLIC_ACTIONS.has(action) && !AUTH_ACTIONS.has(action)) {
    return { status: 400, body: { ok: false, error: 'Unknown action.' } };
  }

  const limited = await rateLimit(store, merged, action);
  if (limited && limited.allowed === false) {
    return { status: 429, body: { ok: false, error: 'Too many requests.' } };
  }

  if (action === 'bootstrap') return handleBootstrap(store);
  if (action === 'register') return handleRegister(store, body, merged);

  const auth = await requireAdmin(store, merged.request, merged);
  if (!auth.ok) return { status: auth.status, body: { ok: false, error: auth.error } };
  const actor = auth.user;

  if (action === 'products.list') return handleProductsList(env, store, merged);
  if (action === 'products.preview') return handleProductsPreview(env, store, body, merged);
  if (action === 'products.upsert') return handleProductsUpsert(env, store, body, actor, merged);
  if (action === 'products.delete') return handleProductsDelete(store, body, actor);
  if (action === 'products.reorder') return handleProductsReorder(store, body, actor);
  if (action === 'provider.services') return handleProviderServices(env, store, merged);
  if (action === 'catalogue.refresh') return handleCatalogueRefresh(env, store, actor, merged);

  return { status: 400, body: { ok: false, error: 'Unknown action.' } };
}

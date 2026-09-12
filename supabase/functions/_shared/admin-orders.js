/**
 * Admin order list: field descriptors, query validation, and admin projection.
 * capability_token_hash never leaves the server.
 */

import { PAYMENT_STATES, FULFILLMENT_STATES } from './states.js';
import { refillEligibility } from './refill.js';

const RATE_UNITS = Object.freeze(['per_1000', 'per_unit', 'package', 'per_comment']);

export const CUSTOMER_EMAIL_STATES = Object.freeze([
  'unknown',
  'queued',
  'sent',
  'accepted',
  'delivered',
  'bounced',
  'failed',
]);

export const REFILL_STATES = Object.freeze([
  'requested',
  'pending',
  'completed',
  'rejected',
  'failed',
  'unknown',
]);

export const ORDER_SEARCH_FIELDS = Object.freeze([
  'display_id',
  'email',
  'provider_order_id',
  'stripe_session_id',
  'stripe_payment_intent_id',
]);

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const OPS = Object.freeze({
  text: Object.freeze(['eq', 'contains', 'is_null']),
  uuid: Object.freeze(['eq']),
  enum: Object.freeze(['eq', 'in', 'is_null']),
  int: Object.freeze(['eq', 'gte', 'lte']),
  numeric: Object.freeze(['eq', 'gte', 'lte']),
  bool: Object.freeze(['eq', 'is_null']),
  timestamp: Object.freeze(['eq', 'gte', 'lte']),
  json: Object.freeze([]),
});

/**
 * @param {string} type
 * @param {{ group: string, values?: readonly string[], list?: boolean, sortable?: boolean, filterable?: boolean }} spec
 */
function field(type, spec) {
  const filterable = spec.filterable ?? type !== 'json';
  const sortable = spec.sortable ?? type !== 'json';
  return Object.freeze({
    type,
    group: spec.group,
    sortable,
    filterable,
    list: Boolean(spec.list),
    operators: filterable ? OPS[type] : Object.freeze([]),
    values: spec.values || null,
  });
}

export const ORDER_FIELDS = Object.freeze({
  id: field('uuid', { group: 'order' }),
  display_id: field('text', { group: 'order', list: true }),
  checkout_attempt_id: field('uuid', { group: 'order' }),
  email: field('text', { group: 'customer', list: true }),
  service_id: field('text', { group: 'order', list: true }),
  service_snapshot: field('json', { group: 'order' }),
  provider_service_id: field('text', { group: 'provider' }),
  provider_type: field('text', { group: 'provider' }),
  provider_payload: field('json', { group: 'provider' }),
  quantity: field('int', { group: 'order' }),
  billable_quantity: field('int', { group: 'order' }),
  currency: field('text', { group: 'pricing', list: true }),
  amount_minor: field('int', { group: 'pricing', list: true }),
  quote_version: field('text', { group: 'pricing' }),
  rate_unit: field('enum', { group: 'order', values: RATE_UNITS }),
  retail_rate_minor: field('int', { group: 'pricing' }),
  markup: field('numeric', { group: 'pricing' }),
  inputs: field('json', { group: 'order' }),
  params_fingerprint: field('text', { group: 'order' }),
  payment_status: field('enum', { group: 'stripe', values: PAYMENT_STATES, list: true }),
  fulfillment_status: field('enum', { group: 'provider', values: FULFILLMENT_STATES, list: true }),
  stripe_session_id: field('text', { group: 'stripe' }),
  stripe_payment_intent_id: field('text', { group: 'stripe' }),
  stripe_livemode: field('bool', { group: 'stripe' }),
  checkout_revision: field('int', { group: 'order' }),
  provider_order_id: field('text', { group: 'provider', list: true }),
  provider_dispatched_at: field('timestamp', { group: 'provider' }),
  provider_status_raw: field('text', { group: 'provider' }),
  provider_charge: field('text', { group: 'provider' }),
  provider_currency: field('text', { group: 'provider' }),
  provider_start_count: field('text', { group: 'provider' }),
  provider_remains: field('text', { group: 'provider' }),
  provider_last_status_at: field('timestamp', { group: 'provider' }),
  created_at: field('timestamp', { group: 'order', list: true }),
  updated_at: field('timestamp', { group: 'order' }),
  customer_email_state: field('enum', { group: 'customer', values: CUSTOMER_EMAIL_STATES }),
  expected_provider_cost_minor: field('int', { group: 'pricing' }),
  expected_contribution_minor: field('int', { group: 'pricing' }),
  fx_provider_to_retail: field('numeric', { group: 'pricing' }),
  fx_quoted_at: field('timestamp', { group: 'pricing' }),
  stripe_integration_identifier: field('text', { group: 'stripe' }),
  min_contribution_minor: field('int', { group: 'pricing' }),
  provider_refill_id: field('text', { group: 'refill' }),
  provider_refill_status: field('enum', { group: 'refill', values: REFILL_STATES, list: true }),
  provider_refill_requested_at: field('timestamp', { group: 'refill' }),
  provider_refill_last_status_at: field('timestamp', { group: 'refill' }),
});

const HIDDEN_COLUMNS = Object.freeze(['capability_token_hash']);

/**
 * @param {Record<string, unknown>|null|undefined} order
 */
export function toAdminOrder(order) {
  if (!order || typeof order !== 'object') return null;
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const name of Object.keys(ORDER_FIELDS)) {
    out[name] = order[name] === undefined ? null : order[name];
  }
  for (const hidden of HIDDEN_COLUMNS) {
    delete out[hidden];
  }
  return out;
}

function isUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/**
 * @param {unknown} raw
 */
function normalizeFilterList(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') {
    return Object.entries(raw).map(([fieldName, spec]) => {
      if (spec && typeof spec === 'object' && !Array.isArray(spec)) {
        const item = /** @type {Record<string, unknown>} */ (spec);
        return { field: fieldName, op: item.op, value: item.value };
      }
      return { field: fieldName, op: 'eq', value: spec };
    });
  }
  return [];
}

function parseIntValue(value, errors, label) {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return Number(value.trim());
  errors.push(`${label} must be an integer.`);
  return null;
}

function parseNumberValue(value, errors, label) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  errors.push(`${label} must be a number.`);
  return null;
}

function parseTimestamp(value, errors, label) {
  const text = String(value ?? '').trim();
  if (!text || Number.isNaN(Date.parse(text))) {
    errors.push(`${label} must be an ISO timestamp.`);
    return null;
  }
  return text;
}

function parseBool(value, errors, label) {
  if (value === true || value === false) return value;
  const text = String(value ?? '').trim().toLowerCase();
  if (text === 'true' || text === '1') return true;
  if (text === 'false' || text === '0') return false;
  errors.push(`${label} must be a boolean.`);
  return null;
}

function sanitizeSearch(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return '';
  return text.slice(0, 200).replace(/[^a-zA-Z0-9@.+_:\-\s]/g, '');
}

function parseFilterValue(spec, op, value, errors) {
  if (op === 'is_null') {
    const flag = parseBool(value == null ? true : value, errors, spec.type);
    return flag;
  }
  if (op === 'in') {
    const list = Array.isArray(value) ? value.map((item) => String(item)) : String(value ?? '').split(',').map((item) => item.trim()).filter(Boolean);
    if (!list.length) {
      errors.push(`Filter ${spec.type} requires at least one value.`);
      return [];
    }
    if (spec.values) {
      const allowed = new Set(spec.values);
      for (const item of list) {
        if (!allowed.has(item)) errors.push(`Unknown value for filter: ${item}`);
      }
    }
    return list;
  }
  if (spec.type === 'enum') {
    const text = String(value ?? '').trim();
    if (spec.values && !spec.values.includes(text)) {
      errors.push(`Unknown value for filter: ${text}`);
      return text;
    }
    return text;
  }
  if (spec.type === 'uuid') {
    const text = String(value ?? '').trim();
    if (!isUuid(text)) errors.push('Filter value must be a UUID.');
    return text;
  }
  if (spec.type === 'int') return parseIntValue(value, errors, 'Filter value');
  if (spec.type === 'numeric') return parseNumberValue(value, errors, 'Filter value');
  if (spec.type === 'timestamp') return parseTimestamp(value, errors, 'Filter value');
  if (spec.type === 'bool') return parseBool(value, errors, 'Filter value');
  const text = String(value ?? '');
  if (text.length > 200) errors.push('Filter value is too long.');
  return text;
}

/**
 * @param {Record<string, unknown>} body
 * @returns {{ ok: false, errors: string[] }|{ ok: true, value: {
 *   page: number,
 *   pageSize: number,
 *   sort: string,
 *   dir: 'asc'|'desc',
 *   q: string,
 *   filters: Array<{ field: string, op: string, value: unknown }>
 * } }}
 */
export function parseOrderQuery(body) {
  const errors = [];
  const row = body && typeof body === 'object' ? body : {};
  const page = parseIntValue(row.page ?? 1, errors, 'page') ?? 1;
  if (page < 1) errors.push('page must be ≥ 1.');
  const pageSize = parseIntValue(row.pageSize ?? row.page_size ?? DEFAULT_PAGE_SIZE, errors, 'pageSize') ?? DEFAULT_PAGE_SIZE;
  if (pageSize < 1 || pageSize > MAX_PAGE_SIZE) errors.push(`pageSize must be 1–${MAX_PAGE_SIZE}.`);

  const sort = String(row.sort ?? row.sortField ?? row.sort_field ?? 'created_at').trim();
  const spec = ORDER_FIELDS[sort];
  if (!spec || !spec.sortable) errors.push('Invalid sort field.');
  const dirRaw = String(row.dir ?? row.sortDir ?? row.sort_dir ?? 'desc').trim().toLowerCase();
  if (dirRaw !== 'asc' && dirRaw !== 'desc') errors.push('Sort direction must be asc or desc.');
  const dir = dirRaw === 'asc' ? 'asc' : 'desc';

  const q = sanitizeSearch(row.q);
  /** @type {Array<{ field: string, op: string, value: unknown }>} */
  const filters = [];
  for (const item of normalizeFilterList(row.filters)) {
    const fieldName = String(item?.field || '').trim();
    const fieldSpec = ORDER_FIELDS[fieldName];
    if (!fieldSpec || !fieldSpec.filterable) {
      errors.push(`Unknown or unfilterable field: ${fieldName || '(empty)'}`);
      continue;
    }
    const op = String(item?.op || 'eq').trim();
    if (!fieldSpec.operators.includes(op)) {
      errors.push(`Invalid operator ${op} for ${fieldName}.`);
      continue;
    }
    const value = parseFilterValue(fieldSpec, op, item?.value, errors);
    filters.push({ field: fieldName, op, value });
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      page,
      pageSize,
      sort,
      dir,
      q,
      filters,
    },
  };
}

function escapeIlike(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/**
 * @param {any} query
 * @param {ReturnType<typeof parseOrderQuery> extends { ok: true, value: infer V } ? V : never} parsed
 */
export function applySupabaseOrderFilters(query, parsed) {
  let next = query;
  for (const filter of parsed.filters) {
    if (filter.op === 'eq') next = next.eq(filter.field, filter.value);
    else if (filter.op === 'contains') next = next.ilike(filter.field, `%${escapeIlike(filter.value)}%`);
    else if (filter.op === 'in') next = next.in(filter.field, filter.value);
    else if (filter.op === 'gte') next = next.gte(filter.field, filter.value);
    else if (filter.op === 'lte') next = next.lte(filter.field, filter.value);
    else if (filter.op === 'is_null') {
      next = filter.value ? next.is(filter.field, null) : next.not(filter.field, 'is', null);
    }
  }
  if (parsed.q) {
    const term = escapeIlike(parsed.q);
    const clause = ORDER_SEARCH_FIELDS.map((name) => `${name}.ilike.%${term}%`).join(',');
    next = next.or(clause);
  }
  return next
    .order(parsed.sort, { ascending: parsed.dir === 'asc', nullsFirst: false })
    .order('id', { ascending: true });
}

function compareValues(a, b, type) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (type === 'int' || type === 'numeric') return Number(a) - Number(b);
  if (type === 'timestamp') return Date.parse(String(a)) - Date.parse(String(b));
  if (type === 'bool') return Number(Boolean(a)) - Number(Boolean(b));
  return String(a).localeCompare(String(b));
}

function matchesFilter(row, filter) {
  const current = row[filter.field];
  if (filter.op === 'eq') {
    if (typeof filter.value === 'boolean') return Boolean(current) === filter.value && current != null;
    return String(current ?? '') === String(filter.value ?? '');
  }
  if (filter.op === 'contains') {
    return String(current ?? '').toLowerCase().includes(String(filter.value ?? '').toLowerCase());
  }
  if (filter.op === 'in') {
    return Array.isArray(filter.value) && filter.value.map(String).includes(String(current ?? ''));
  }
  if (filter.op === 'gte') return compareValues(current, filter.value, ORDER_FIELDS[filter.field].type) >= 0;
  if (filter.op === 'lte') return compareValues(current, filter.value, ORDER_FIELDS[filter.field].type) <= 0;
  if (filter.op === 'is_null') return filter.value ? current == null : current != null;
  return false;
}

/**
 * @param {any[]} rows
 * @param {ReturnType<typeof parseOrderQuery> extends { ok: true, value: infer V } ? V : never} parsed
 */
export function applyMemoryOrderQuery(rows, parsed) {
  const filtered = rows.filter((row) => {
    if (!parsed.filters.every((filter) => matchesFilter(row, filter))) return false;
    if (!parsed.q) return true;
    const needle = parsed.q.toLowerCase();
    return ORDER_SEARCH_FIELDS.some((name) => String(row[name] || '').toLowerCase().includes(needle));
  });
  const spec = ORDER_FIELDS[parsed.sort];
  filtered.sort((a, b) => {
    const cmp = compareValues(a[parsed.sort], b[parsed.sort], spec.type);
    const ordered = parsed.dir === 'asc' ? cmp : -cmp;
    if (ordered) return ordered;
    return String(a.id).localeCompare(String(b.id));
  });
  const total = filtered.length;
  const start = (parsed.page - 1) * parsed.pageSize;
  return { rows: filtered.slice(start, start + parsed.pageSize), total };
}

function projectJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    task: job.task,
    status: job.status,
    attempts: job.attempts,
    max_attempts: job.max_attempts,
    next_retry_at: job.next_retry_at,
    outcome: job.outcome,
    external_ref: job.external_ref,
    created_at: job.created_at,
    updated_at: job.updated_at,
  };
}

function projectEvent(row) {
  return {
    id: row.id,
    actor: row.actor,
    action: row.action,
    from_state: row.from_state,
    to_state: row.to_state,
    reason: row.reason,
    created_at: row.created_at,
  };
}

function projectRequest(row) {
  return {
    id: row.id,
    vendor: row.vendor,
    action: row.action,
    outcome: row.outcome,
    external_ref: row.external_ref || row.externalRef || null,
    attempted_at: row.attempted_at || row.attemptedAt || null,
    created_at: row.created_at,
  };
}

/**
 * @param {object} env
 * @param {object} store
 * @param {Record<string, unknown>} body
 */
export async function handleOrdersList(env, store, body) {
  const parsed = parseOrderQuery(body);
  if (!parsed.ok) return { status: 400, body: { ok: false, error: parsed.errors[0], errors: parsed.errors } };
  const result = await store.listOrders(parsed.value);
  return {
    status: 200,
    body: {
      ok: true,
      rows: (result.rows || []).map(toAdminOrder),
      total: Number(result.total || 0),
      page: parsed.value.page,
      pageSize: parsed.value.pageSize,
      sort: parsed.value.sort,
      dir: parsed.value.dir,
      fields: ORDER_FIELDS,
    },
  };
}

/**
 * @param {object} env
 * @param {object} store
 * @param {Record<string, unknown>} body
 * @param {object} extras
 */
export async function handleOrdersGet(env, store, body, extras = {}) {
  const orderId = String(body.orderId || body.id || '').trim();
  if (!isUuid(orderId)) return { status: 400, body: { ok: false, error: 'Order id is required.' } };
  const order = await store.getOrderById(orderId);
  if (!order) return { status: 404, body: { ok: false, error: 'Order not found.' } };
  const [events, jobs, requests, refill] = await Promise.all([
    store.listOrderEvents(orderId),
    store.listOrderJobs(orderId),
    store.listOrderExternalRequests(orderId),
    refillEligibility(env, store, order, extras),
  ]);
  return {
    status: 200,
    body: {
      ok: true,
      order: toAdminOrder(order),
      refill,
      events: (events || []).map(projectEvent),
      jobs: (jobs || []).map(projectJob),
      requests: (requests || []).map(projectRequest),
      fields: ORDER_FIELDS,
    },
  };
}

/**
 * @param {object} env
 * @param {object} store
 * @param {Record<string, unknown>} body
 * @param {{ id: string, email?: string }} actor
 * @param {object} extras
 */
export async function handleOrdersRefill(env, store, body, actor, extras = {}) {
  const orderId = String(body.orderId || body.id || '').trim();
  if (!isUuid(orderId)) return { status: 400, body: { ok: false, error: 'Order id is required.' } };
  const order = await store.getOrderById(orderId);
  if (!order) return { status: 404, body: { ok: false, error: 'Order not found.' } };
  const eligibility = await refillEligibility(env, store, order, extras);
  if (!eligibility.eligible) {
    return { status: 409, body: { ok: false, error: eligibility.reason || 'Refill is not available.', refill: eligibility } };
  }

  const requestedAt = extras.now ? new Date(extras.now()).toISOString() : new Date().toISOString();
  await store.updateOrder(order.id, {
    provider_refill_status: 'requested',
    provider_refill_requested_at: requestedAt,
  });
  await store.enqueueJob({
    orderId: order.id,
    task: 'provider_refill',
    dedupeKey: `refill:${order.id}:${requestedAt}`,
  });
  if (typeof store.appendOrderEvent === 'function') {
    await store.appendOrderEvent({
      orderId: order.id,
      actor: actor.email || actor.id || 'admin',
      action: 'admin.refill_requested',
      reason: 'Admin requested a SocialPanel24 refill.',
    });
  }
  const latest = await store.getOrderById(order.id);
  return {
    status: 202,
    body: {
      ok: true,
      accepted: true,
      order: toAdminOrder(latest),
      refill: { eligible: false, reason: 'refill_in_flight' },
    },
  };
}

export { isUuid };

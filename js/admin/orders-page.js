import { formatMoney } from '../utils/money.js';
import { createEl, clearChildren, setText } from '../utils/dom.js';
import { getSession, requireSession, signOut } from './auth.js';
import { adminAction } from './api.js';

const GROUP_LABELS = {
  order: 'Order',
  customer: 'Customer',
  pricing: 'Pricing',
  stripe: 'Stripe',
  provider: 'Provider',
  refill: 'Refill',
};

const REFILL_REASONS = {
  not_paid: 'Payment is not paid.',
  missing_provider_order: 'No SocialPanel24 order id.',
  not_refillable_status: 'Fulfilment is not completed or partial.',
  refill_in_flight: 'A refill is already in progress.',
  refill_unknown: 'A previous refill outcome is unknown. Do not retry automatically.',
  refill_not_supported: 'This provider service does not support refill.',
  service_not_found: 'Provider service was not found in the catalogue.',
  provider_unavailable: 'Provider catalogue is unavailable.',
  provider_kill_switch: 'Provider kill switch is on.',
  test_stripe: 'Test-mode Stripe charges cannot be refilled.',
  provider_disabled: 'SocialPanel24 is disabled.',
  provider_not_live: 'Provider environment is not live.',
  non_production: 'Live provider calls are not allowed in this environment.',
};

const WARN_STATES = new Set([
  'submission_unknown',
  'blocked_balance',
  'deferred',
  'review',
  'requested',
  'pending',
  'partial',
]);
const BAD_STATES = new Set(['failed', 'cancelled', 'rejected', 'unknown', 'expired']);
const OK_STATES = new Set(['paid', 'completed', 'delivered', 'sent', 'accepted']);

/** @type {Record<string, { type: string, group: string, sortable: boolean, filterable: boolean, list?: boolean, operators: string[], values?: string[]|null }>} */
let fields = {};
/** @type {object[]} */
let rows = [];
let total = 0;
let page = 1;
let pageSize = 25;
let sortField = 'created_at';
let sortDir = 'desc';
let queryText = '';
/** @type {Record<string, { op: string, value: unknown }>} */
let filterState = {};
let selectedId = '';
/** @type {object|null} */
let detail = null;
let listTimer = 0;
let loading = false;
let filtersBuilt = false;

function labelize(name) {
  return String(name || '').replace(/_/g, ' ');
}

function badgeClass(value) {
  const key = String(value || '');
  if (OK_STATES.has(key)) return 'badge badge--ok';
  if (WARN_STATES.has(key)) return 'badge badge--warn';
  if (BAD_STATES.has(key)) return 'badge badge--bad';
  return 'badge badge--muted';
}

function setBanner(message, kind = '') {
  const el = document.getElementById('admin-banner');
  if (!el) return;
  if (!message) {
    el.hidden = true;
    el.textContent = '';
    el.className = 'admin-banner';
    return;
  }
  el.hidden = false;
  el.textContent = message;
  el.className = `admin-banner${kind ? ` admin-banner--${kind}` : ''}`;
}

function listColumns() {
  const named = Object.entries(fields)
    .filter(([, spec]) => spec.list)
    .map(([name]) => name);
  return named.length
    ? named
    : ['display_id', 'created_at', 'email', 'payment_status', 'fulfillment_status', 'amount_minor'];
}

function displayValue(name, value) {
  const spec = fields[name];
  if (value == null || value === '') return '—';
  if (spec?.type === 'json') {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  if (name === 'amount_minor' || name.endsWith('_minor')) {
    const currency = detail?.order?.currency || rows.find((row) => row.id === selectedId)?.currency || 'USD';
    return formatMoney(value, currency);
  }
  if (spec?.type === 'bool') return value ? 'yes' : 'no';
  if (spec?.type === 'timestamp') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
  }
  return String(value);
}

function collectFilters() {
  return Object.entries(filterState)
    .filter(([, spec]) => spec && spec.value !== '' && spec.value != null && !(Array.isArray(spec.value) && !spec.value.length))
    .map(([key, spec]) => ({
      field: String(spec.field || key.replace(/__(gte|lte)$/, '')),
      op: spec.op,
      value: spec.value,
    }));
}

function scheduleList() {
  window.clearTimeout(listTimer);
  listTimer = window.setTimeout(() => {
    page = 1;
    void loadList();
  }, 300);
}

async function loadList() {
  if (loading) return;
  loading = true;
  try {
    const { response, json } = await adminAction('orders.list', {
      page,
      pageSize,
      sort: sortField,
      dir: sortDir,
      q: queryText,
      filters: collectFilters(),
    });
    if (!response.ok || !json?.ok) {
      setBanner(json?.error || 'Could not load orders.', 'bad');
      return;
    }
    fields = json.fields || fields;
    rows = Array.isArray(json.rows) ? json.rows : [];
    total = Number(json.total || 0);
    page = Number(json.page || page);
    pageSize = Number(json.pageSize || pageSize);
    if (json.sort) sortField = json.sort;
    if (json.dir) sortDir = json.dir;
    if (!selectedId || !rows.some((row) => row.id === selectedId)) {
      selectedId = rows[0]?.id || '';
    }
    renderFilters();
    renderTable();
    renderPager();
    if (selectedId) await loadDetail(selectedId);
    else renderDetail();
  } catch (err) {
    setBanner(err instanceof Error ? err.message : 'Could not load orders.', 'bad');
  } finally {
    loading = false;
  }
}

async function loadDetail(orderId) {
  selectedId = orderId;
  const { response, json } = await adminAction('orders.get', { orderId });
  if (!response.ok || !json?.ok) {
    setBanner(json?.error || 'Could not load order.', 'bad');
    detail = null;
    renderTable();
    renderDetail();
    return;
  }
  if (json.fields) fields = json.fields;
  detail = json;
  renderTable();
  renderDetail();
}

function setFilter(field, op, value) {
  if (value == null || value === '' || (Array.isArray(value) && !value.length)) {
    delete filterState[field];
  } else {
    filterState[field] = { op, value };
  }
}

function renderFilters(force = false) {
  const host = document.getElementById('admin-order-filters');
  if (!host || !Object.keys(fields).length) return;
  if (filtersBuilt && !force) return;
  filtersBuilt = true;
  clearChildren(host);

  const search = labeledInput('Search', () => {
    const input = createEl('input', {
      className: 'admin-input',
      type: 'search',
      id: 'filter-q',
      placeholder: 'Id, email, provider or Stripe id',
    });
    input.value = queryText;
    input.addEventListener('input', () => {
      queryText = input.value;
      scheduleList();
    });
    return input;
  });
  host.append(search);

  host.append(
    enumFilter('payment_status', 'Payment'),
    enumFilter('fulfillment_status', 'Fulfilment'),
    textFilter('email', 'Email', 'eq')
  );

  const advanced = createEl('details', { className: 'admin-filter-advanced' });
  advanced.append(createEl('summary', {}, 'All field filters'));
  const extra = createEl('div', { className: 'admin-filters' });
  Object.entries(fields).forEach(([name, spec]) => {
    if (!spec.filterable) return;
    if (['payment_status', 'fulfillment_status', 'email'].includes(name)) return;
    extra.append(fieldFilter(name, spec));
  });
  const clear = createEl('button', { type: 'button', className: 'btn btn--secondary' }, 'Clear filters');
  clear.addEventListener('click', () => {
    filterState = {};
    queryText = '';
    page = 1;
    filtersBuilt = false;
    void loadList();
  });
  extra.append(clear);
  advanced.append(extra);
  host.append(advanced);
}

function labeledInput(label, control) {
  const wrap = createEl('label', { className: 'form-field' });
  wrap.append(createEl('span', {}, label), control());
  return wrap;
}

function fieldFilter(name, spec) {
  if (spec.type === 'enum') return enumFilter(name, labelize(name));
  if (spec.type === 'timestamp') return rangeFilter(name, spec.type);
  if (spec.type === 'int' || spec.type === 'numeric') return rangeFilter(name, spec.type);
  if (spec.type === 'bool') return boolFilter(name);
  return textFilter(name, labelize(name), spec.operators.includes('contains') ? 'contains' : 'eq');
}

function enumFilter(name, label) {
  const spec = fields[name];
  return labeledInput(label, () => {
    const select = createEl('select', { className: 'admin-input', multiple: 'multiple' });
    (spec?.values || []).forEach((value) => {
      const option = createEl('option', { value }, value);
      const selected = filterState[name]?.value;
      if (Array.isArray(selected) && selected.includes(value)) option.selected = true;
      if (selected === value) option.selected = true;
      select.append(option);
    });
    select.addEventListener('change', () => {
      const values = [...select.selectedOptions].map((option) => option.value);
      if (values.length > 1) setFilter(name, 'in', values);
      else if (values.length === 1) setFilter(name, 'eq', values[0]);
      else setFilter(name, 'eq', '');
      scheduleList();
    });
    return select;
  });
}

function textFilter(name, label, op) {
  return labeledInput(label, () => {
    const input = createEl('input', { className: 'admin-input', type: 'text' });
    input.value = filterState[name] ? String(filterState[name].value ?? '') : '';
    input.addEventListener('input', () => {
      setFilter(name, op, input.value.trim());
      scheduleList();
    });
    return input;
  });
}

function boolFilter(name) {
  return labeledInput(labelize(name), () => {
    const select = createEl('select', { className: 'admin-input' });
    [
      ['', 'Any'],
      ['true', 'Yes'],
      ['false', 'No'],
      ['null', 'Empty'],
    ].forEach(([value, label]) => {
      const option = createEl('option', { value }, label);
      const current = filterState[name];
      if (!current && value === '') option.selected = true;
      if (current?.op === 'is_null' && value === 'null') option.selected = true;
      if (current?.op === 'eq' && String(current.value) === value) option.selected = true;
      select.append(option);
    });
    select.addEventListener('change', () => {
      if (select.value === '') setFilter(name, 'eq', '');
      else if (select.value === 'null') setFilter(name, 'is_null', true);
      else setFilter(name, 'eq', select.value === 'true');
      scheduleList();
    });
    return select;
  });
}

function rangeFilter(name, type) {
  const wrap = createEl('div', { className: 'form-field' });
  wrap.append(createEl('span', {}, labelize(name)));
  const row = createEl('div', { className: 'admin-flags' });
  const from = createEl('input', {
    className: 'admin-input',
    type: type === 'timestamp' ? 'date' : 'number',
    placeholder: 'From',
  });
  const to = createEl('input', {
    className: 'admin-input',
    type: type === 'timestamp' ? 'date' : 'number',
    placeholder: 'To',
  });
  const gte = filterState[`${name}__gte`];
  const lte = filterState[`${name}__lte`];
  if (gte?.value) from.value = String(gte.value).slice(0, 10);
  if (lte?.value) to.value = String(lte.value).slice(0, 10);
  const apply = () => {
    delete filterState[`${name}__gte`];
    delete filterState[`${name}__lte`];
    delete filterState[name];
    if (from.value) {
      const value = type === 'timestamp' ? `${from.value}T00:00:00.000Z` : Number(from.value);
      filterState[`${name}__gte`] = { field: name, op: 'gte', value };
    }
    if (to.value) {
      const value = type === 'timestamp' ? `${to.value}T23:59:59.999Z` : Number(to.value);
      filterState[`${name}__lte`] = { field: name, op: 'lte', value };
    }
    scheduleList();
  };
  from.addEventListener('change', apply);
  to.addEventListener('change', apply);
  row.append(from, to);
  wrap.append(row);
  return wrap;
}

function renderTable() {
  const host = document.getElementById('admin-order-table');
  if (!host) return;
  clearChildren(host);
  const table = createEl('table', { className: 'admin-table' });
  const thead = createEl('thead');
  const headerRow = createEl('tr');
  listColumns().forEach((name) => {
    const th = createEl('th');
    const spec = fields[name];
    if (spec?.sortable) {
      const marker = sortField === name ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';
      const btn = createEl('button', { type: 'button' }, `${labelize(name)}${marker}`);
      btn.addEventListener('click', () => {
        if (sortField === name) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
        else {
          sortField = name;
          sortDir = 'desc';
        }
        page = 1;
        void loadList();
      });
      th.append(btn);
    } else {
      th.append(document.createTextNode(labelize(name)));
    }
    headerRow.append(th);
  });
  headerRow.append(createEl('th', {}, 'Actions'));
  thead.append(headerRow);
  const tbody = createEl('tbody');
  rows.forEach((row) => {
    const tr = createEl('tr');
    if (row.id === selectedId) tr.classList.add('is-selected');
    tr.addEventListener('click', () => {
      void loadDetail(row.id);
    });
    listColumns().forEach((name) => {
      const td = createEl('td');
      if (name === 'payment_status' || name === 'fulfillment_status' || name === 'provider_refill_status') {
        td.append(createEl('span', { className: badgeClass(row[name]) }, String(row[name] || '—')));
      } else if (name === 'amount_minor') {
        td.append(document.createTextNode(formatMoney(row[name], row.currency || 'USD')));
      } else {
        td.append(document.createTextNode(displayValue(name, row[name])));
      }
      tr.append(td);
    });
    const actions = createEl('td');
    const byEmail = createEl('button', { type: 'button', className: 'btn btn--tiny btn--secondary' }, 'This customer');
    byEmail.addEventListener('click', (event) => {
      event.stopPropagation();
      filterByEmail(row.email);
    });
    actions.append(byEmail);
    tr.append(actions);
    tbody.append(tr);
  });
  if (!rows.length) {
    const empty = createEl('tr');
    const td = createEl('td', { colspan: String(listColumns().length + 1) }, 'No orders match these filters.');
    empty.append(td);
    tbody.append(empty);
  }
  table.append(thead, tbody);
  host.append(table);
}

function renderPager() {
  const host = document.getElementById('admin-order-pager');
  if (!host) return;
  clearChildren(host);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const summary = createEl('span', { className: 'admin-muted' }, `${total} order${total === 1 ? '' : 's'} · page ${page} of ${pages}`);
  const prev = createEl('button', { type: 'button', className: 'btn btn--secondary btn--tiny' }, 'Previous');
  prev.disabled = page <= 1;
  prev.addEventListener('click', () => {
    page = Math.max(1, page - 1);
    void loadList();
  });
  const next = createEl('button', { type: 'button', className: 'btn btn--secondary btn--tiny' }, 'Next');
  next.disabled = page >= pages;
  next.addEventListener('click', () => {
    page += 1;
    void loadList();
  });
  host.append(summary, prev, next);
}

function filterByEmail(email) {
  const value = String(email || '');
  filterState = { email: { op: 'eq', value } };
  queryText = '';
  page = 1;
  filtersBuilt = false;
  void loadList();
}

function renderDetail() {
  const host = document.getElementById('admin-order-detail');
  if (!host) return;
  clearChildren(host);
  if (!detail?.order) {
    host.append(createEl('p', { className: 'admin-muted' }, 'Select an order to preview every field.'));
    return;
  }
  const order = detail.order;
  const wrap = createEl('div', { className: 'admin-detail admin-form' });
  wrap.append(createEl('h2', {}, order.display_id || order.id));

  const actions = createEl('div', { className: 'admin-detail__actions' });
  const refill = createEl('button', { type: 'button', className: 'btn' }, 'Request refill');
  const eligible = Boolean(detail.refill?.eligible);
  refill.disabled = !eligible;
  const reason = detail.refill?.reason ? REFILL_REASONS[detail.refill.reason] || detail.refill.reason : '';
  if (reason) refill.title = reason;
  refill.addEventListener('click', () => void requestRefill(order));
  const byEmail = createEl('button', { type: 'button', className: 'btn btn--secondary' }, 'All orders from this customer');
  byEmail.addEventListener('click', () => filterByEmail(order.email));
  actions.append(refill, byEmail);
  if (reason && !eligible) actions.append(createEl('p', { className: 'admin-muted' }, reason));
  wrap.append(actions);

  Object.entries(GROUP_LABELS).forEach(([group, label]) => {
    const section = createEl('section', { className: 'admin-preview' });
    section.append(createEl('h3', {}, label));
    const dl = createEl('dl', { className: 'admin-facts' });
    Object.entries(fields)
      .filter(([, spec]) => spec.group === group)
      .forEach(([name, spec]) => {
        dl.append(createEl('dt', {}, labelize(name)));
        const dd = createEl('dd');
        const value = order[name];
        if (name === 'payment_status' || name === 'fulfillment_status' || name === 'provider_refill_status') {
          dd.append(createEl('span', { className: badgeClass(value) }, String(value || '—')));
        } else if (spec.type === 'json') {
          dd.append(createEl('pre', { className: 'admin-json' }, displayValue(name, value)));
        } else {
          dd.append(document.createTextNode(displayValue(name, value)));
        }
        dl.append(dd);
      });
    section.append(dl);
    wrap.append(section);
  });

  wrap.append(listSection('Status timeline', detail.events || [], (event) => {
    const item = createEl('li');
    item.append(
      createEl('strong', {}, event.action || 'event'),
      document.createTextNode(` · ${event.actor || 'system'}`),
      createEl('div', { className: 'admin-muted' }, `${event.from_state || '—'} → ${event.to_state || '—'}`),
      createEl('div', { className: 'admin-muted' }, `${event.reason || ''} ${event.created_at || ''}`.trim())
    );
    return item;
  }));

  wrap.append(listSection('Jobs', detail.jobs || [], (job) => {
    const item = createEl('li');
    item.append(
      createEl('strong', {}, job.task || 'job'),
      document.createTextNode(` · ${job.status || ''}`),
      createEl('div', { className: 'admin-muted' }, `attempts ${job.attempts || 0}/${job.max_attempts || 12}`),
      createEl('div', { className: 'admin-muted' }, job.next_retry_at ? `next ${job.next_retry_at}` : '')
    );
    return item;
  }));

  wrap.append(listSection('External requests', detail.requests || [], (request) => {
    const item = createEl('li');
    item.append(
      createEl('strong', {}, `${request.vendor || ''} ${request.action || ''}`.trim()),
      document.createTextNode(` · ${request.outcome || ''}`),
      createEl('div', { className: 'admin-muted' }, request.attempted_at || request.created_at || '')
    );
    return item;
  }));

  host.append(wrap);
}

function listSection(title, items, renderItem) {
  const section = createEl('section', { className: 'admin-preview' });
  section.append(createEl('h3', {}, title));
  if (!items.length) {
    section.append(createEl('p', { className: 'admin-muted' }, 'None yet.'));
    return section;
  }
  const list = createEl('ul', { className: 'admin-timeline' });
  items.forEach((item) => list.append(renderItem(item)));
  section.append(list);
  return section;
}

async function requestRefill(order) {
  if (!window.confirm(`Request a SocialPanel24 refill for ${order.display_id || order.id}?`)) return;
  const { response, json } = await adminAction('orders.refill', { orderId: order.id });
  if (!response.ok || !json?.ok) {
    setBanner(json?.error || 'Refill was not accepted.', 'bad');
    return;
  }
  setBanner('Refill requested. The worker will call SocialPanel24.', 'ok');
  await loadDetail(order.id);
  void loadList();
}

export async function initOrdersPage() {
  if (!requireSession()) return;
  const session = getSession();
  setText(document.getElementById('admin-user'), session?.user?.email || 'Admin');
  document.getElementById('admin-signout')?.addEventListener('click', () => {
    signOut();
    window.location.replace('/admin/');
  });
  await loadList();
}

if (document.body?.dataset?.page === 'admin-orders') {
  initOrdersPage();
}

import { formatMoney } from '../utils/money.js';
import { createEl, clearChildren, setText } from '../utils/dom.js';
import { getSession, requireSession, signOut } from './auth.js';
import { adminAction } from './api.js';
import { createMappingPicker, filterAndGroupServices } from './mapping-picker.js';

const STOREFRONT_INPUTS = [
  'url',
  'username',
  'comments',
  'usernames',
  'hashtags',
  'hashtag',
  'media',
  'groups',
  'runs',
  'interval',
  'country',
  'device',
  'type_of_traffic',
  'google_keyword',
  'referring_url',
];

const RATE_UNITS = ['per_1000', 'per_unit', 'package', 'per_comment'];

const STATUS_LABELS = {
  '': 'Mapped',
  mapped: 'Mapped',
  unmapped: 'Unmapped',
  missing: 'Missing',
  unsupported_type: 'Unsupported type',
  hidden: 'Hidden',
  unavailable: 'Unavailable',
};

/** @type {object[]} */
let products = [];
/** @type {object[]} */
let providerServices = [];
let selectedId = '';
let creating = false;
/** @type {{ platform: string, slug: string }|null} */
let originalRoute = null;
/** @type {ReturnType<typeof createMappingPicker>|null} */
let picker = null;
let previewTimer = 0;
let providerGroupBy = 'category';
let providerSortBy = 'name';
let providerQuery = '';

function statusOf(product) {
  return product.disableReason || (product.socialpanelId ? 'mapped' : 'unmapped');
}

function badgeClass(reason) {
  if (!reason) return 'badge badge--ok';
  if (reason === 'unmapped') return 'badge badge--warn';
  if (reason === 'hidden') return 'badge badge--muted';
  return 'badge badge--bad';
}

function uniquePlatforms(rows) {
  return [...new Set(rows.map((row) => row.platform).filter(Boolean))].sort();
}

function groupProducts(rows) {
  /** @type {Map<string, object[]>} */
  const groups = new Map();
  rows.forEach((row) => {
    const key = row.platform || 'other';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });
  return [...groups.entries()].map(([platform, items]) => ({
    platform,
    label: items[0]?.platformLabel || platform,
    items,
  }));
}

function filters() {
  return {
    q: String(document.getElementById('filter-q')?.value || '')
      .trim()
      .toLowerCase(),
    platform: String(document.getElementById('filter-platform')?.value || ''),
    status: String(document.getElementById('filter-status')?.value || ''),
    rateUnit: String(document.getElementById('filter-rate')?.value || ''),
  };
}

function filteredProducts() {
  const { q, platform, status, rateUnit } = filters();
  return products.filter((row) => {
    if (platform && row.platform !== platform) return false;
    if (rateUnit && row.rateUnit !== rateUnit) return false;
    if (status) {
      const reason = statusOf(row);
      if (status === 'mapped' && reason !== 'mapped' && reason !== '') return false;
      if (status !== 'mapped' && reason !== status) return false;
    }
    if (q) {
      const hay = `${row.id} ${row.label} ${row.service} ${row.slug} ${row.socialpanelId} ${row.providerName}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function setBanner(message, kind = '') {
  const el = document.getElementById('admin-banner');
  if (!el) return;
  el.hidden = !message;
  el.textContent = message || '';
  el.className = `admin-banner${kind ? ` admin-banner--${kind}` : ''}`;
}

function selectedProduct() {
  if (creating) return null;
  return products.find((row) => row.id === selectedId) || null;
}

function formValue(name) {
  const el = document.querySelector(`[name="${name}"]`);
  if (!el) return '';
  if (el instanceof HTMLInputElement && el.type === 'checkbox') return el.checked;
  return el.value;
}

function collectInputs() {
  return STOREFRONT_INPUTS.filter((name) => {
    const el = document.querySelector(`[name="input-${name}"]`);
    return el instanceof HTMLInputElement && el.checked;
  });
}

function readDraft() {
  const current = selectedProduct();
  return {
    id: String(formValue('id') || (creating ? '' : current?.id || '')),
    platform: String(formValue('platform')).trim().toLowerCase(),
    platformLabel: String(formValue('platformLabel')).trim(),
    service: String(formValue('service')).trim(),
    slug: String(formValue('slug')).trim().toLowerCase(),
    label: String(formValue('label')).trim(),
    description: String(formValue('description')),
    inputs: collectInputs(),
    visible: Boolean(formValue('visible')),
    dripEnabled: Boolean(formValue('dripEnabled')),
    socialpanelId: picker?.getValue() || String(formValue('socialpanelId') || ''),
    rateUnit: String(formValue('rateUnit')),
    retailCurrency: String(formValue('retailCurrency') || 'USD').toUpperCase(),
    markupMultiplier: Number(formValue('markupMultiplier')),
    quantityStep: Number(formValue('quantityStep')),
    quantityDefault: formValue('quantityDefault') === '' ? null : Number(formValue('quantityDefault')),
    packagePriceMinor: formValue('packagePriceMinor') === '' ? null : Number(formValue('packagePriceMinor')),
    minContributionMinor: formValue('minContributionMinor') === '' ? 30 : Number(formValue('minContributionMinor')),
    sortOrder: formValue('sortOrder') === '' ? 0 : Number(formValue('sortOrder')),
  };
}

function routeNeedsRebuild(draft) {
  if (creating) return true;
  if (!originalRoute) return false;
  return draft.platform !== originalRoute.platform || draft.slug !== originalRoute.slug;
}

async function loadData() {
  const [productRes, providerRes] = await Promise.all([
    adminAction('products.list'),
    adminAction('provider.services'),
  ]);
  if (!productRes.response.ok) throw new Error(productRes.json?.error || 'Could not load products.');
  products = productRes.json.products || [];
  providerServices = providerRes.json.services || [];
  if (productRes.json.providerError) {
    setBanner(`Provider catalogue: ${productRes.json.providerError}`, 'warn');
  } else {
    setBanner('');
  }
}

function fillPlatformFilter() {
  const select = document.getElementById('filter-platform');
  if (!(select instanceof HTMLSelectElement)) return;
  const current = select.value;
  clearChildren(select);
  select.append(new Option('All platforms', ''));
  uniquePlatforms(products).forEach((platform) => {
    const label = products.find((row) => row.platform === platform)?.platformLabel || platform;
    select.append(new Option(label, platform));
  });
  if ([...select.options].some((opt) => opt.value === current)) select.value = current;
}

function renderList() {
  const root = document.getElementById('admin-list');
  if (!root) return;
  clearChildren(root);
  const rows = filteredProducts();
  if (!rows.length) {
    root.append(createEl('p', { className: 'admin-muted' }, 'No products match these filters.'));
    return;
  }
  const filtering = Boolean(filters().q || filters().status || filters().rateUnit);
  groupProducts(rows).forEach((group) => {
    const details = createEl('details', { className: 'admin-group' });
    details.open = true;
    details.append(createEl('summary', {}, `${group.label} (${group.items.length})`));
    const ul = createEl('ul', { className: 'admin-product-list' });
    group.items.forEach((row) => {
      const li = createEl('li', { className: 'admin-product' });
      if (row.id === selectedId && !creating) li.classList.add('is-selected');
      if (!filtering) li.draggable = true;
      li.dataset.id = row.id;
      li.dataset.platform = row.platform;
      const btn = createEl('button', { type: 'button', className: 'admin-product__btn' });
      btn.append(
        createEl('span', { className: 'admin-product__name' }, row.label || `${row.platformLabel} ${row.service}`),
        createEl('span', { className: badgeClass(row.disableReason) }, STATUS_LABELS[row.disableReason] || 'Mapped')
      );
      btn.addEventListener('click', () => selectProduct(row.id));
      const move = createEl('span', { className: 'admin-product__move' });
      const up = createEl('button', { type: 'button', className: 'btn btn--tiny', 'aria-label': 'Move up' }, '↑');
      const down = createEl('button', { type: 'button', className: 'btn btn--tiny', 'aria-label': 'Move down' }, '↓');
      up.addEventListener('click', (event) => {
        event.stopPropagation();
        void moveProduct(row.id, -1);
      });
      down.addEventListener('click', (event) => {
        event.stopPropagation();
        void moveProduct(row.id, 1);
      });
      move.append(up, down);
      li.append(btn, move);
      bindDrag(li);
      ul.append(li);
    });
    details.append(ul);
    root.append(details);
  });
}

function bindDrag(li) {
  li.addEventListener('dragstart', (event) => {
    event.dataTransfer?.setData('text/plain', li.dataset.id || '');
    li.classList.add('is-dragging');
  });
  li.addEventListener('dragend', () => li.classList.remove('is-dragging'));
  li.addEventListener('dragover', (event) => {
    event.preventDefault();
    li.classList.add('is-drop');
  });
  li.addEventListener('dragleave', () => li.classList.remove('is-drop'));
  li.addEventListener('drop', (event) => {
    event.preventDefault();
    li.classList.remove('is-drop');
    const fromId = event.dataTransfer?.getData('text/plain');
    const toId = li.dataset.id;
    if (!fromId || !toId || fromId === toId) return;
    void reorderWithinPlatform(fromId, toId);
  });
}

async function persistOrder(ids) {
  const { response, json } = await adminAction('products.reorder', { ids });
  if (!response.ok) {
    setBanner(json?.error || 'Could not save order.', 'bad');
    return;
  }
  await loadData();
  fillPlatformFilter();
  renderList();
}

async function moveProduct(id, direction) {
  const product = products.find((row) => row.id === id);
  if (!product) return;
  const siblings = products.filter((row) => row.platform === product.platform);
  const index = siblings.findIndex((row) => row.id === id);
  const next = index + direction;
  if (next < 0 || next >= siblings.length) return;
  const copy = siblings.map((row) => row.id);
  const [item] = copy.splice(index, 1);
  copy.splice(next, 0, item);
  const ids = groupProducts(products).flatMap((group) =>
    group.platform === product.platform ? copy : group.items.map((row) => row.id)
  );
  await persistOrder(ids);
}

async function reorderWithinPlatform(fromId, toId) {
  const from = products.find((row) => row.id === fromId);
  const to = products.find((row) => row.id === toId);
  if (!from || !to || from.platform !== to.platform) return;
  const siblings = products.filter((row) => row.platform === from.platform).map((row) => row.id);
  const fromIndex = siblings.indexOf(fromId);
  const toIndex = siblings.indexOf(toId);
  const [item] = siblings.splice(fromIndex, 1);
  siblings.splice(toIndex, 0, item);
  const ids = groupProducts(products).flatMap((group) =>
    group.platform === from.platform ? siblings : group.items.map((row) => row.id)
  );
  await persistOrder(ids);
}

function field(name, label, control) {
  const wrap = createEl('label', { className: 'form-field' });
  wrap.append(createEl('span', {}, label), control);
  control.setAttribute('name', name);
  return wrap;
}

function input(name, attrs = {}) {
  const el = createEl('input', { className: 'admin-input', name, ...attrs });
  return el;
}

function fillForm(product) {
  const root = document.getElementById('admin-editor');
  if (!root) return;
  clearChildren(root);

  const title = createEl('h2', {}, creating ? 'New product' : product?.label || 'Product');
  const form = createEl('form', { className: 'admin-form', id: 'product-form' });

  const idInput = input('id', { value: creating ? '' : product?.id || '', autocomplete: 'off' });
  if (!creating) idInput.readOnly = true;
  form.append(field('id', 'Id', idInput));
  form.append(field('platform', 'Platform slug', input('platform', { value: product?.platform || '', required: 'true' })));
  form.append(
    field('platformLabel', 'Platform label', input('platformLabel', { value: product?.platformLabel || '', required: 'true' }))
  );
  form.append(field('service', 'Service', input('service', { value: product?.service || '', required: 'true' })));
  form.append(field('slug', 'Slug', input('slug', { value: product?.slug || '', required: 'true' })));
  form.append(field('label', 'Label', input('label', { value: product?.label || '' })));
  const desc = createEl('textarea', { className: 'admin-input', name: 'description', rows: '3' }, '');
  desc.value = product?.description || '';
  form.append(field('description', 'Description', desc));

  const unit = createEl('select', { className: 'admin-input', name: 'rateUnit' });
  RATE_UNITS.forEach((value) => unit.append(new Option(value, value)));
  unit.value = product?.rateUnit || 'per_1000';
  form.append(field('rateUnit', 'Rate unit', unit));
  form.append(
    field(
      'markupMultiplier',
      'Markup multiplier',
      input('markupMultiplier', { type: 'number', min: '1', step: '0.01', value: String(product?.markupMultiplier ?? 2) })
    )
  );
  form.append(
    field('quantityStep', 'Quantity step', input('quantityStep', { type: 'number', min: '1', step: '1', value: String(product?.quantityStep ?? 1) }))
  );
  form.append(
    field(
      'quantityDefault',
      'Quantity default',
      input('quantityDefault', {
        type: 'number',
        step: '1',
        value: product?.quantityDefault == null ? '' : String(product.quantityDefault),
      })
    )
  );
  form.append(
    field(
      'packagePriceMinor',
      'Package price (minor units)',
      input('packagePriceMinor', {
        type: 'number',
        min: '0',
        step: '1',
        value: product?.packagePriceMinor == null ? '' : String(product.packagePriceMinor),
      })
    )
  );
  form.append(
    field(
      'minContributionMinor',
      'Min contribution (minor units)',
      input('minContributionMinor', {
        type: 'number',
        min: '0',
        step: '1',
        value: String(product?.minContributionMinor ?? 30),
      })
    )
  );
  form.append(
    field('sortOrder', 'Sort order', input('sortOrder', { type: 'number', step: '1', value: String(product?.sortOrder ?? 0) }))
  );
  form.append(field('retailCurrency', 'Currency', input('retailCurrency', { value: product?.retailCurrency || 'USD', maxlength: '3' })));

  const flags = createEl('div', { className: 'admin-flags' });
  const visible = createEl('input', { type: 'checkbox', name: 'visible' });
  visible.checked = product?.visible !== false;
  const drip = createEl('input', { type: 'checkbox', name: 'dripEnabled' });
  drip.checked = Boolean(product?.dripEnabled);
  const visLabel = createEl('label', { className: 'admin-check' });
  visLabel.append(visible, document.createTextNode(' Visible on storefront'));
  const dripLabel = createEl('label', { className: 'admin-check' });
  dripLabel.append(drip, document.createTextNode(' Drip enabled'));
  flags.append(visLabel, dripLabel);
  form.append(flags);

  const inputsBox = createEl('fieldset', { className: 'admin-inputs' });
  inputsBox.append(createEl('legend', {}, 'Storefront inputs'));
  const selectedInputs = new Set(product?.inputs || ['url']);
  STOREFRONT_INPUTS.forEach((name) => {
    const box = createEl('label', { className: 'admin-check' });
    const cb = createEl('input', { type: 'checkbox', name: `input-${name}` });
    cb.checked = selectedInputs.has(name);
    box.append(cb, document.createTextNode(` ${name}`));
    inputsBox.append(box);
  });
  form.append(inputsBox);

  const mapWrap = createEl('div', { className: 'admin-mapping' });
  mapWrap.append(createEl('h3', {}, 'SocialPanel24 mapping'));
  picker = createMappingPicker(mapWrap, {
    onSelect() {
      schedulePreview();
      updateRebuildWarning();
    },
  });
  picker.setServices(providerServices);
  picker.setValue(product?.socialpanelId || '');
  form.append(mapWrap);

  const preview = createEl('div', { className: 'admin-preview', id: 'admin-preview' });
  form.append(preview);

  const warn = createEl('p', { className: 'admin-banner admin-banner--warn', id: 'rebuild-warning' });
  warn.hidden = true;
  form.append(warn);

  const actions = createEl('div', { className: 'admin-actions' });
  const save = createEl('button', { type: 'submit', className: 'btn' }, creating ? 'Create product' : 'Save product');
  actions.append(save);
  if (!creating && product) {
    const del = createEl('button', { type: 'button', className: 'btn btn--danger' }, 'Delete');
    del.addEventListener('click', () => void deleteProduct(product.id));
    actions.append(del);
  }
  form.append(actions);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void saveProduct();
  });
  form.addEventListener('input', () => {
    schedulePreview();
    updateRebuildWarning();
  });

  root.append(title, form);
  renderPreview(product);
  updateRebuildWarning();
}

function renderPreview(product) {
  const root = document.getElementById('admin-preview');
  if (!root) return;
  clearChildren(root);
  if (!product) {
    root.append(createEl('p', { className: 'admin-muted' }, 'Save or select a mapping to preview retail pricing.'));
    return;
  }
  const reason = product.disableReason || '';
  root.append(createEl('h3', {}, 'Live preview'));
  root.append(
    createEl(
      'p',
      { className: badgeClass(reason) },
      reason ? STATUS_LABELS[reason] || reason : product.purchasable ? 'Purchasable' : 'Mapped'
    )
  );
  const facts = createEl('dl', { className: 'admin-facts' });
  const rows = [
    ['Provider', product.providerName ? `#${product.socialpanelId} ${product.providerName}` : product.socialpanelId || '—'],
    ['Type', `${product.providerType || '—'} ${product.typeSupported === false ? '(unsupported)' : ''}`],
    ['Provider rate', product.providerRate || '—'],
    ['Quantity', `${product.providerMin ?? '—'}–${product.providerMax ?? '—'} step ${product.quantityStep ?? '—'}`],
    ['Quantity mode', product.quantityMode || '—'],
    ['Inputs', (product.inputs || []).join(', ') || '—'],
    [
      'Retail rate',
      Number.isInteger(product.retailRateMinor)
        ? `${formatMoney(product.retailRateMinor, product.currency || 'USD')} / ${product.rateUnit}`
        : '—',
    ],
  ];
  rows.forEach(([dt, dd]) => {
    facts.append(createEl('dt', {}, dt), createEl('dd', {}, dd));
  });
  root.append(facts);
}

function updateRebuildWarning() {
  const el = document.getElementById('rebuild-warning');
  if (!el) return;
  const draft = readDraft();
  const needed = routeNeedsRebuild(draft);
  el.hidden = !needed;
  el.textContent = needed
    ? 'New platform or slug pages are generated at build time. Mapping, price, and visibility go live on Publish; a storefront redeploy is required before /platform/slug/ exists.'
    : '';
}

function schedulePreview() {
  window.clearTimeout(previewTimer);
  previewTimer = window.setTimeout(() => void runPreview(), 280);
}

async function runPreview() {
  const draft = readDraft();
  if (!draft.socialpanelId && !draft.service) return;
  const { response, json } = await adminAction('products.preview', { product: draft });
  if (!response.ok) return;
  renderPreview(json.product);
}

function selectProduct(id) {
  creating = false;
  selectedId = id;
  const product = selectedProduct();
  originalRoute = product ? { platform: product.platform, slug: product.slug } : null;
  renderList();
  fillForm(product);
}

function startCreate(seed) {
  creating = true;
  selectedId = '';
  originalRoute = null;
  renderList();
  fillForm(
    seed || {
      visible: true,
      inputs: ['url'],
      rateUnit: 'per_1000',
      markupMultiplier: 2,
      quantityStep: 1,
      quantityDefault: 1000,
      minContributionMinor: 30,
      retailCurrency: 'USD',
    }
  );
}

async function saveProduct() {
  const draft = readDraft();
  const { response, json } = await adminAction('products.upsert', { product: draft });
  if (!response.ok) {
    setBanner(json?.error || 'Could not save product.', 'bad');
    return;
  }
  setBanner(json.created ? 'Product created. Publish to refresh the storefront catalogue.' : 'Product saved.', 'ok');
  await loadData();
  fillPlatformFilter();
  creating = false;
  selectedId = json.product?.id || draft.id;
  originalRoute = json.product ? { platform: json.product.platform, slug: json.product.slug } : null;
  renderList();
  fillForm(json.product);
  renderProviderTab();
}

async function deleteProduct(id) {
  if (!window.confirm('Delete this storefront product? Mapping is lost; past orders keep their snapshot.')) return;
  const { response, json } = await adminAction('products.delete', { id });
  if (!response.ok) {
    setBanner(json?.error || 'Could not delete product.', 'bad');
    return;
  }
  setBanner('Product deleted.', 'ok');
  await loadData();
  fillPlatformFilter();
  selectedId = products[0]?.id || '';
  creating = false;
  originalRoute = products[0] ? { platform: products[0].platform, slug: products[0].slug } : null;
  renderList();
  fillForm(selectedProduct());
}

async function publish() {
  setBanner('Refreshing catalogue…');
  const { response, json } = await adminAction('catalogue.refresh');
  if (!response.ok) {
    setBanner(json?.providerError || json?.error || 'Refresh failed.', 'bad');
    return;
  }
  setBanner(
    `Published. ${json.purchasable} purchasable, ${json.unmapped} unmapped, ${json.missing} missing of ${json.providerCount} provider services.`,
    'ok'
  );
  await loadData();
  fillPlatformFilter();
  renderList();
  if (creating) fillForm(readDraft());
  else fillForm(selectedProduct());
  renderProviderTab();
}

function renderProviderTab() {
  const toolbar = document.getElementById('admin-provider-toolbar');
  const list = document.getElementById('admin-provider-list');
  if (!toolbar || !list) return;
  if (!toolbar.dataset.ready) {
    const search = createEl('input', {
      type: 'search',
      className: 'admin-input',
      placeholder: 'Search provider services',
      'aria-label': 'Search provider catalogue',
      id: 'provider-q',
    });
    const group = createEl('select', { className: 'admin-input', id: 'provider-group', 'aria-label': 'Group by' });
    group.append(new Option('Group by category', 'category'), new Option('Group by type', 'type'));
    const sort = createEl('select', { className: 'admin-input', id: 'provider-sort', 'aria-label': 'Sort by' });
    sort.append(new Option('Sort by name', 'name'), new Option('Sort by rate', 'rate'), new Option('Sort by min quantity', 'min'));
    search.addEventListener('input', () => {
      providerQuery = search.value;
      renderProviderTab();
    });
    group.addEventListener('change', () => {
      providerGroupBy = group.value;
      renderProviderTab();
    });
    sort.addEventListener('change', () => {
      providerSortBy = sort.value;
      renderProviderTab();
    });
    toolbar.append(search, group, sort);
    toolbar.dataset.ready = '1';
  }
  clearChildren(list);
  const grouped = filterAndGroupServices(providerServices, {
    query: providerQuery,
    groupBy: providerGroupBy,
    sortBy: providerSortBy,
  });
  if (!grouped.length) {
    list.append(createEl('p', { className: 'admin-muted' }, 'No provider services to show.'));
    return;
  }
  grouped.forEach((group) => {
    const details = createEl('details', { className: 'admin-group' });
    details.open = grouped.length < 6;
    details.append(createEl('summary', {}, `${group.key} (${group.items.length})`));
    const ul = createEl('ul', { className: 'admin-provider-list' });
    group.items.forEach((row) => {
      const li = createEl('li', { className: 'admin-provider' });
      const mapped = products.filter((product) => String(product.socialpanelId) === String(row.service));
      const meta = createEl('div');
      meta.append(
        createEl('strong', {}, `#${row.service} ${row.name}`),
        createEl('span', { className: 'admin-muted' }, ` ${row.type} · ${row.rate} · min ${row.min}–${row.max}`)
      );
      if (!row.typeEnabled) meta.append(createEl('span', { className: 'badge badge--bad' }, 'Unsupported type'));
      if (mapped.length) {
        meta.append(
          createEl('span', { className: 'badge badge--ok' }, mapped.map((item) => item.label).join(', '))
        );
      }
      const create = createEl('button', { type: 'button', className: 'btn btn--tiny' }, 'Create product from this service');
      create.addEventListener('click', () => {
        showTab('products');
        startCreate({
          ...(row.suggested || {}),
          socialpanelId: String(row.service),
          inputs: row.storefrontInputs || ['url'],
          rateUnit: row.suggested?.rateUnit || 'per_1000',
        });
      });
      li.append(meta, create);
      ul.append(li);
    });
    details.append(ul);
    list.append(details);
  });
}

function showTab(name) {
  const productsTab = document.getElementById('admin-tab-products');
  const providerTab = document.getElementById('admin-tab-provider');
  document.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.classList.toggle('is-active', btn.getAttribute('data-tab') === name);
  });
  if (productsTab) productsTab.hidden = name !== 'products';
  if (providerTab) providerTab.hidden = name !== 'provider';
}

export async function initProductsPage() {
  if (!requireSession()) return;
  const session = getSession();
  setText(document.getElementById('admin-user'), session?.user?.email || 'Admin');

  document.getElementById('admin-signout')?.addEventListener('click', () => {
    signOut();
    window.location.replace('/admin/');
  });
  document.getElementById('admin-new')?.addEventListener('click', () => startCreate());
  document.getElementById('admin-publish')?.addEventListener('click', () => void publish());
  document.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => showTab(btn.getAttribute('data-tab') || 'products'));
  });
  ['filter-q', 'filter-platform', 'filter-status', 'filter-rate'].forEach((id) => {
    document.getElementById(id)?.addEventListener('input', renderList);
    document.getElementById(id)?.addEventListener('change', renderList);
  });

  try {
    await loadData();
  } catch (err) {
    setBanner(err instanceof Error ? err.message : 'Could not load admin data.', 'bad');
    return;
  }
  fillPlatformFilter();
  if (!selectedId) selectedId = products[0]?.id || '';
  originalRoute = selectedProduct() ? { platform: selectedProduct().platform, slug: selectedProduct().slug } : null;
  renderList();
  fillForm(selectedProduct());
  renderProviderTab();
}

if (document.body?.dataset?.page === 'admin-products') {
  initProductsPage();
}

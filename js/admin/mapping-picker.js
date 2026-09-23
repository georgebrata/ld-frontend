import { createEl, clearChildren } from '../utils/dom.js';

/**
 * @param {object} a
 * @param {object} b
 * @param {string} sortBy
 */
function compareServices(a, b, sortBy) {
  if (sortBy === 'rate') {
    const diff = Number(a.rate) - Number(b.rate);
    return Number.isFinite(diff) && diff !== 0 ? diff : String(a.name || '').localeCompare(String(b.name || ''));
  }
  if (sortBy === 'min') {
    const diff = Number(a.min) - Number(b.min);
    return Number.isFinite(diff) && diff !== 0 ? diff : String(a.name || '').localeCompare(String(b.name || ''));
  }
  return String(a.name || '').localeCompare(String(b.name || ''));
}

function groupKey(row, groupBy) {
  if (groupBy === 'type') return String(row.type || 'Unknown type');
  return String(row.category || 'Uncategorized');
}

function matchesQuery(row, query) {
  if (!query) return true;
  const hay = `${row.service} ${row.name} ${row.type} ${row.category}`.toLowerCase();
  return hay.includes(query);
}

/**
 * @param {object[]} services
 * @param {{ query?: string, groupBy?: string, sortBy?: string }} options
 */
export function filterAndGroupServices(services, options = {}) {
  const query = String(options.query || '')
    .trim()
    .toLowerCase();
  const groupBy = options.groupBy === 'type' ? 'type' : 'category';
  const sortBy = options.sortBy === 'rate' || options.sortBy === 'min' ? options.sortBy : 'name';
  const filtered = (services || []).filter((row) => matchesQuery(row, query));
  /** @type {Map<string, object[]>} */
  const groups = new Map();
  filtered.forEach((row) => {
    const key = groupKey(row, groupBy);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, items]) => ({
      key,
      items: items.slice().sort((a, b) => compareServices(a, b, sortBy)),
    }));
}

/**
 * Searchable SocialPanel24 picker grouped by category or type.
 * @param {HTMLElement} container
 * @param {{ onSelect?: (service: object|null) => void }} [options]
 */
export function createMappingPicker(container, options = {}) {
  let services = [];
  let selectedId = '';
  let groupBy = 'category';
  let sortBy = 'name';
  let query = '';

  const search = createEl('input', {
    type: 'search',
    className: 'admin-input',
    placeholder: 'Search by name, id, type, or category',
    'aria-label': 'Search provider services',
  });
  const groupSelect = createEl('select', { className: 'admin-input', 'aria-label': 'Group provider services' });
  groupSelect.append(new Option('Group by category', 'category'), new Option('Group by type', 'type'));
  const sortSelect = createEl('select', { className: 'admin-input', 'aria-label': 'Sort provider services' });
  sortSelect.append(
    new Option('Sort by name', 'name'),
    new Option('Sort by rate', 'rate'),
    new Option('Sort by min quantity', 'min')
  );
  const current = createEl('p', { className: 'mapping-picker__current' });
  const list = createEl('div', { className: 'mapping-picker__list', role: 'listbox', 'aria-label': 'Provider services' });
  const toolbar = createEl('div', { className: 'mapping-picker__toolbar' });
  toolbar.append(search, groupSelect, sortSelect);

  clearChildren(container);
  container.classList.add('mapping-picker');
  container.append(toolbar, current, list);

  function selected() {
    return services.find((row) => String(row.service) === String(selectedId)) || null;
  }

  function renderCurrent() {
    const row = selected();
    clearChildren(current);
    if (!row) {
      current.textContent = 'No SocialPanel service mapped.';
      return;
    }
    current.textContent = '';
    current.append(
      createEl('strong', {}, `#${row.service}`),
      document.createTextNode(` ${row.name} · ${row.type} · ${row.rate}`)
    );
    const clearBtn = createEl('button', { type: 'button', className: 'btn btn--tiny' }, 'Clear');
    clearBtn.addEventListener('click', () => {
      selectedId = '';
      render();
      options.onSelect?.(null);
    });
    current.append(clearBtn);
  }

  function renderList() {
    clearChildren(list);
    const grouped = filterAndGroupServices(services, { query, groupBy, sortBy });
    if (!grouped.length) {
      list.append(createEl('p', { className: 'admin-muted' }, 'No provider services match.'));
      return;
    }
    grouped.forEach((group) => {
      const details = createEl('details', { className: 'mapping-picker__group' });
      details.open = grouped.length < 8 || group.items.some((row) => String(row.service) === String(selectedId));
      details.append(createEl('summary', {}, `${group.key} (${group.items.length})`));
      const ul = createEl('ul');
      group.items.forEach((row) => {
        const li = createEl('li');
        const btn = createEl('button', { type: 'button', className: 'mapping-picker__item' });
        if (String(row.service) === String(selectedId)) btn.classList.add('is-selected');
        if (row.typeEnabled === false) btn.classList.add('is-unsupported');
        btn.append(
          createEl('span', { className: 'mapping-picker__id' }, `#${row.service}`),
          createEl('span', { className: 'mapping-picker__name' }, row.name || 'Untitled'),
          createEl('span', { className: 'mapping-picker__meta' }, `${row.type} · ${row.rate} · min ${row.min}`)
        );
        btn.addEventListener('click', () => {
          selectedId = String(row.service);
          render();
          options.onSelect?.(row);
        });
        li.append(btn);
        ul.append(li);
      });
      details.append(ul);
      list.append(details);
    });
  }

  function render() {
    renderCurrent();
    renderList();
  }

  search.addEventListener('input', () => {
    query = search.value;
    renderList();
  });
  groupSelect.addEventListener('change', () => {
    groupBy = groupSelect.value;
    renderList();
  });
  sortSelect.addEventListener('change', () => {
    sortBy = sortSelect.value;
    renderList();
  });

  render();

  return {
    setServices(next) {
      services = Array.isArray(next) ? next : [];
      render();
    },
    setValue(id) {
      selectedId = id == null ? '' : String(id);
      render();
    },
    getValue() {
      return selectedId;
    },
    getSelected() {
      return selected();
    },
  };
}

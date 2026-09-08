import { servicesApi } from '../api/services-api.js';
import { createCardFrameSvg, formatCardPrice } from '../components/card-frame.js';
import { renderEmpty, renderError, renderLoading } from '../components/catalogue-states.js';
import { mountCheckoutForm } from '../checkout/checkout-form.js';
import { createEl, clearChildren } from '../utils/dom.js';
import { prefersReducedMotion, scrollToSection } from '../utils/motion.js';
import { getPlatformIconUrl, getPlatformInitials } from '../utils/platform-icons.js';

/**
 * @param {HTMLElement} wrap
 * @param {string} platform
 * @param {string} platformLabel
 */
function appendPlatformIcon(wrap, platform, platformLabel) {
  const iconUrl = getPlatformIconUrl(platform);
  if (iconUrl) {
    const img = createEl('img', { src: iconUrl, alt: '' });
    img.style.width = '70%';
    wrap.appendChild(img);
    return;
  }
  wrap.appendChild(createEl('span', { className: 'platform-badge' }, getPlatformInitials(platformLabel)));
}

/**
 * @param {HTMLElement} grid
 * @param {(index: number) => void} onSelect
 */
function bindRadioKeys(grid, onSelect) {
  grid.addEventListener('keydown', (event) => {
    const items = Array.from(grid.querySelectorAll('[role="radio"]'));
    const current = items.indexOf(document.activeElement);
    if (current < 0) return;
    let next = current;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (current + 1) % items.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      next = (current - 1 + items.length) % items.length;
    } else if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      onSelect(current);
      return;
    } else {
      return;
    }
    event.preventDefault();
    items[next]?.focus();
  });
}

/**
 * @param {string} platform
 * @param {string} [serviceSlug]
 */
function syncHomeUrl(platform, serviceSlug) {
  if (document.body.dataset.page !== 'home') return;
  const url = new URL(window.location.href);
  if (platform) url.searchParams.set('platform', platform);
  else url.searchParams.delete('platform');
  if (serviceSlug) url.searchParams.set('service', serviceSlug);
  else url.searchParams.delete('service');
  history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}

/**
 * @param {HTMLElement} section
 */
function showStep(section) {
  section.hidden = false;
  section.classList.remove('order-step--enter');
  if (!prefersReducedMotion()) {
    section.classList.add('order-step--enter');
  }
}

/**
 * Initialise the one-page platform → service → checkout flow.
 * @param {{ platform?: string, serviceId?: string, serviceSlug?: string }} [preset]
 */
export async function initOnePageOrder(preset = {}) {
  const host = document.getElementById('order-root') || document.getElementById('catalogue-root');
  if (!host) return;

  renderLoading(host);

  /** @type {import('../types.js').Service[]} */
  let services = [];
  try {
    services = await servicesApi.getServices();
  } catch {
    renderError(host, () => initOnePageOrder(preset));
    return;
  }

  if (!services.length) {
    renderEmpty(host);
    return;
  }

  const platforms = servicesApi.getUniquePlatforms(services);
  const params = new URLSearchParams(window.location.search);
  let selectedPlatform =
    preset.platform || document.body.dataset.platform || params.get('platform') || '';
  let selectedServiceId = preset.serviceId || document.body.dataset.serviceId || '';
  let selectedSlug = preset.serviceSlug || params.get('service') || '';

  if (selectedPlatform && !platforms.some((p) => p.platform === selectedPlatform)) {
    selectedPlatform = '';
    selectedServiceId = '';
    selectedSlug = '';
  }

  clearChildren(host);
  host.classList.add('order-root');

  const platformsSection = createEl('section', {
    id: 'platforms',
    className: 'order-step',
    'aria-labelledby': 'platforms-heading',
  });
  platformsSection.appendChild(
    createEl('h2', { className: 'order-step__title', id: 'platforms-heading' }, 'Choose a platform')
  );
  const platformsGrid = createEl('div', {
    id: 'platforms-root',
    className: 'order-grid order-grid--platforms',
    role: 'radiogroup',
    'aria-labelledby': 'platforms-heading',
  });
  platformsSection.appendChild(platformsGrid);

  const servicesSection = createEl('section', {
    id: 'services-step',
    className: 'order-step',
    'aria-labelledby': 'services-heading',
  });
  servicesSection.hidden = true;
  servicesSection.appendChild(
    createEl('h2', { className: 'order-step__title', id: 'services-heading' }, 'Choose a service')
  );
  const servicesGrid = createEl('div', {
    id: 'services-root',
    className: 'order-grid order-grid--services',
    role: 'radiogroup',
    'aria-labelledby': 'services-heading',
  });
  servicesSection.appendChild(servicesGrid);

  const checkoutSection = createEl('section', {
    id: 'checkout',
    className: 'order-step',
    'aria-labelledby': 'checkout-heading',
  });
  checkoutSection.hidden = true;
  checkoutSection.appendChild(
    createEl('h2', { className: 'order-step__title', id: 'checkout-heading' }, 'Checkout')
  );
  const checkoutRoot = createEl('div', { id: 'checkout-root', className: 'checkout-panel' });
  checkoutSection.appendChild(checkoutRoot);

  host.appendChild(platformsSection);
  host.appendChild(servicesSection);
  host.appendChild(checkoutSection);

  /**
   * @param {string} platform
   */
  function renderServices(platform) {
    clearChildren(servicesGrid);
    const filtered = services.filter((s) => s.platform === platform);
    if (!filtered.length) {
      renderEmpty(servicesGrid, 'No services are available for this platform.');
      return;
    }

    filtered.forEach((service, index) => {
      const selected = service.id === selectedServiceId || service.slug === selectedSlug;
      const card = createEl('button', {
        className: `gcard service-card${selected ? ' is-selected' : ''}`,
        type: 'button',
        role: 'radio',
        'aria-checked': selected ? 'true' : 'false',
        'aria-label': service.label,
        tabindex: index === 0 || selected ? '0' : '-1',
      });

      const front = createEl('div', { className: 'gcard-front service-card-front' });
      front.appendChild(createCardFrameSvg());
      const logo = createEl('div', { className: 'gcard-logo service-card-logo' });
      const typeEl = createEl('div', {
        className: 'service-title gcard-value gcard-type service-card-type',
      });
      typeEl.appendChild(createEl('p', {}, service.service));
      logo.appendChild(typeEl);
      appendPlatformIcon(logo, service.platform, service.platformLabel);
      if (service.description) {
        logo.appendChild(createEl('p', { className: 'service-card-desc' }, service.description));
      }
      const priceEl = createEl('div', {
        className: 'service-title gcard-value service-card-value',
      });
      priceEl.appendChild(
        createEl('p', {}, service.purchasable ? formatCardPrice(service.price) : 'Unavailable')
      );
      logo.appendChild(priceEl);
      front.appendChild(logo);
      card.appendChild(front);
      card.addEventListener('click', () => selectService(service));
      servicesGrid.appendChild(card);
    });
  }

  /**
   * @param {import('../types.js').PlatformSummary} platform
   * @param {{ scroll?: boolean }} [opts]
   */
  function selectPlatform(platform, opts = {}) {
    selectedPlatform = platform.platform;
    if (!opts.keepService) {
      selectedServiceId = '';
      selectedSlug = '';
    }
    syncHomeUrl(selectedPlatform, selectedSlug);

    platformsGrid.querySelectorAll('[role="radio"]').forEach((el) => {
      const isCurrent = el.getAttribute('data-platform') === platform.platform;
      el.classList.toggle('is-selected', isCurrent);
      el.setAttribute('aria-checked', isCurrent ? 'true' : 'false');
      el.tabIndex = isCurrent ? 0 : -1;
    });

    renderServices(platform.platform);
    showStep(servicesSection);
    if (!opts.keepService) {
      checkoutSection.hidden = true;
      clearChildren(checkoutRoot);
    }
    if (opts.scroll !== false) scrollToSection(servicesSection);
  }

  /**
   * @param {import('../types.js').Service} service
   * @param {{ scroll?: boolean }} [opts]
   */
  async function selectService(service, opts = {}) {
    selectedServiceId = service.id;
    selectedSlug = service.slug ?? '';
    syncHomeUrl(service.platform, selectedSlug);

    servicesGrid.querySelectorAll('[role="radio"]').forEach((el) => {
      const isCurrent = el.getAttribute('aria-label') === service.label;
      el.classList.toggle('is-selected', isCurrent);
      el.setAttribute('aria-checked', isCurrent ? 'true' : 'false');
      el.tabIndex = isCurrent ? 0 : -1;
    });

    showStep(checkoutSection);
    if (opts.scroll !== false) scrollToSection(checkoutSection);
    await mountCheckoutForm(checkoutRoot, service);
  }

  platforms.forEach((platform, index) => {
    const selected = platform.platform === selectedPlatform;
    const card = createEl('button', {
      className: `home-card${selected ? ' is-selected' : ''}`,
      type: 'button',
      role: 'radio',
      'aria-checked': selected ? 'true' : 'false',
      'aria-label': platform.platformLabel,
      'data-platform': platform.platform,
      tabindex: index === 0 || selected ? '0' : '-1',
    });
    const front = createEl('div', { className: 'home-card-front' });
    front.appendChild(createCardFrameSvg());
    const logo = createEl('div', { className: 'home-card-logo' });
    appendPlatformIcon(logo, platform.platform, platform.platformLabel);
    front.appendChild(logo);
    card.appendChild(front);
    card.addEventListener('click', () => selectPlatform(platform));
    platformsGrid.appendChild(card);
  });

  bindRadioKeys(platformsGrid, (index) => {
    const platform = platforms[index];
    if (platform) selectPlatform(platform);
  });
  bindRadioKeys(servicesGrid, (index) => {
    const filtered = services.filter((s) => s.platform === selectedPlatform);
    const service = filtered[index];
    if (service) selectService(service);
  });

  if (selectedPlatform) {
    const platform = platforms.find((p) => p.platform === selectedPlatform);
    if (platform) {
      const pendingServiceId = selectedServiceId;
      const pendingSlug = selectedSlug;
      selectPlatform(platform, {
        scroll: false,
        keepService: Boolean(pendingServiceId || pendingSlug),
      });
      const service = services.find(
        (s) =>
          s.platform === selectedPlatform &&
          (s.id === pendingServiceId ||
            s.slug === pendingSlug ||
            s.id === pendingSlug ||
            String(s.service || '').toLowerCase() === String(pendingSlug).toLowerCase())
      );
      if (service) {
        await selectService(service, { scroll: false });
      } else if (pendingServiceId || pendingSlug) {
        renderEmpty(checkoutRoot, 'That service is not available.');
        showStep(checkoutSection);
      }
    }
  }
}

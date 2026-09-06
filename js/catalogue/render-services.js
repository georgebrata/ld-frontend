import { servicesApi } from '../api/services-api.js';
import { getPlatformIconUrl, getPlatformInitials } from '../utils/platform-icons.js';
import { createEl, clearChildren } from '../utils/dom.js';
import { renderLoading, renderEmpty, renderError } from '../components/catalogue-states.js';
import { createCardFrameSvg, formatCardPrice } from '../components/card-frame.js';
import { openCheckoutModal } from '../checkout/checkout-modal.js';

/**
 * Render a service card button.
 * @param {import('../types.js').Service} service
 * @returns {HTMLButtonElement}
 */
function createServiceCard(service) {
  const card = createEl('button', {
    className: 'gcard service-card',
    type: 'button',
    'aria-label': `Order ${service.label}`,
  });

  const front = createEl('div', { className: 'gcard-front service-card-front' });
  front.appendChild(createCardFrameSvg());

  const logoWrap = createEl('div', { className: 'gcard-logo service-card-logo' });

  const typeEl = createEl('div', { className: 'service-title gcard-value gcard-type service-card-type' });
  const typeP = createEl('p', {}, service.service);
  typeEl.appendChild(typeP);
  logoWrap.appendChild(typeEl);

  const iconUrl = getPlatformIconUrl(service.platform);
  if (iconUrl) {
    const img = createEl('img', { src: iconUrl, alt: `${service.platformLabel} logo` });
    logoWrap.appendChild(img);
  } else {
    logoWrap.appendChild(
      createEl('span', { className: 'platform-badge' }, getPlatformInitials(service.platformLabel))
    );
  }

  if (service.description) {
    logoWrap.appendChild(createEl('p', { className: 'service-card-desc' }, service.description));
  }

  const priceEl = createEl('div', { className: 'service-title gcard-value service-card-value' });
  priceEl.appendChild(createEl('p', {}, formatCardPrice(service.price)));
  logoWrap.appendChild(priceEl);

  front.appendChild(logoWrap);
  card.appendChild(front);

  card.addEventListener('click', () => openCheckoutModal(service, card));

  return card;
}

/**
 * Render platform service catalogue.
 * @param {HTMLElement} container
 * @param {string} platformSlug
 */
export async function renderPlatformCatalogue(container, platformSlug) {
  renderLoading(container);

  const load = async () => {
    renderLoading(container);
    try {
      const services = await servicesApi.getServices();
      const filtered = services.filter((s) => s.platform === platformSlug);

      clearChildren(container);

      if (!filtered.length) {
        renderEmpty(container);
        return;
      }

      const grid = createEl('div', { id: 'services' });
      filtered.forEach((service) => grid.appendChild(createServiceCard(service)));
      container.appendChild(grid);
    } catch {
      renderError(container, () => load());
    }
  };

  await load();
}

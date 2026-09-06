import { servicesApi } from '../api/services-api.js';
import { getPlatformIconUrl, getPlatformInitials } from '../utils/platform-icons.js';
import { createEl, clearChildren } from '../utils/dom.js';
import { renderLoading, renderEmpty, renderError } from '../components/catalogue-states.js';
import { createCardFrameSvg } from '../components/card-frame.js';
import { bindPrefetch } from '../utils/prefetch.js';

/**
 * Render a platform icon or badge fallback.
 * @param {string} platform
 * @param {string} platformLabel
 * @returns {HTMLElement}
 */
function createPlatformIcon(platform, platformLabel) {
  const iconUrl = getPlatformIconUrl(platform);
  if (iconUrl) {
    const img = createEl('img', { src: iconUrl, alt: `${platformLabel} logo` });
    img.style.width = '70%';
    return img;
  }
  return createEl('span', { className: 'platform-badge' }, getPlatformInitials(platformLabel));
}

/**
 * Render homepage platform cards.
 * @param {HTMLElement} container
 */
export async function renderHomeCatalogue(container) {
  if (container.querySelector('#home .home-card')) {
    bindPrefetch(container);
    return;
  }

  renderLoading(container);

  const load = async () => {
    renderLoading(container);
    try {
      const services = await servicesApi.getServices();
      const platforms = servicesApi.getUniquePlatforms(services);

      clearChildren(container);

      if (!platforms.length) {
        renderEmpty(container);
        return;
      }

      const home = createEl('div', { id: 'home' });
      platforms.forEach((platform) => {
        const card = createEl('a', {
          className: 'home-card',
          href: platform.url,
          'aria-label': `${platform.platformLabel} services`,
        });

        const front = createEl('div', { className: 'home-card-front' });
        front.appendChild(createCardFrameSvg());

        const logoWrap = createEl('div', { className: 'home-card-logo' });
        logoWrap.appendChild(createPlatformIcon(platform.platform, platform.platformLabel));
        front.appendChild(logoWrap);
        card.appendChild(front);
        home.appendChild(card);
      });

      container.appendChild(home);
      bindPrefetch(container);
    } catch {
      renderError(container, () => load());
    }
  };

  await load();
}

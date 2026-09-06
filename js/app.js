import { initTypedIntro } from './components/typed-intro.js';
import { initOnePageOrder } from './order/one-page.js';
import { initSuccessPage } from './pages/success-page.js';

/**
 * Bootstrap page-specific functionality.
 */
function init() {
  initTypedIntro();

  const pageType = document.body.dataset.page;
  const orderPages = new Set(['home', 'platform', 'service']);

  if (orderPages.has(pageType)) {
    initOnePageOrder({
      platform: document.body.dataset.platform,
      serviceId: document.body.dataset.serviceId,
    });
    return;
  }

  if (pageType === 'success') {
    initSuccessPage();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

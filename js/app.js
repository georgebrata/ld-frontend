import { initTypedIntro } from './components/typed-intro.js';
import { initOnePageOrder } from './order/one-page.js?v=20260909d';
import { initSuccessPage } from './pages/success-page.js';
import { initCancelPage } from './pages/cancel-page.js';

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
    return;
  }

  if (pageType === 'cancel') {
    initCancelPage();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

import { renderHomeCatalogue } from './catalogue/render-home.js';
import { renderPlatformCatalogue } from './catalogue/render-services.js';
import { initConfirmationPage } from './confirmation/confirmation-page.js';
import { initTypedIntro } from './components/typed-intro.js';
import { initServicePage } from './pages/service-page.js';

/**
 * Bootstrap page-specific functionality.
 */
function init() {
  initTypedIntro();

  const pageType = document.body.dataset.page;

  if (pageType === 'home') {
    const container = document.getElementById('catalogue-root');
    if (container) renderHomeCatalogue(container);
    return;
  }

  if (pageType === 'platform') {
    const container = document.getElementById('catalogue-root');
    const platform = document.body.dataset.platform;
    if (container && platform) renderPlatformCatalogue(container, platform);
    return;
  }

  if (pageType === 'service') {
    initServicePage();
    return;
  }

  if (pageType === 'confirmation') {
    initConfirmationPage();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

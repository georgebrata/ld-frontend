function init() {
  const pageType = document.body.dataset.page;
  const orderPages = new Set(['home', 'platform', 'service']);

  if (orderPages.has(pageType)) {
    import('./order/one-page.js').then(({ initOnePageOrder }) => {
      initOnePageOrder({
        platform: document.body.dataset.platform,
        serviceId: document.body.dataset.serviceId,
      });
    });
    return;
  }

  if (pageType === 'success') {
    import('./pages/success-page.js').then(({ initSuccessPage }) => initSuccessPage());
    return;
  }

  if (pageType === 'cancel') {
    import('./pages/cancel-page.js').then(({ initCancelPage }) => initCancelPage());
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

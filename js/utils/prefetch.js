const prefetched = new Set();

/**
 * Insert a prefetch hint for a same-origin href.
 * @param {string} href
 */
export function prefetchHref(href) {
  if (!href || prefetched.has(href)) return;
  if (href.startsWith('http') && !href.startsWith(window.location.origin)) return;

  prefetched.add(href);
  const link = document.createElement('link');
  link.rel = 'prefetch';
  link.href = href;
  document.head.appendChild(link);
}

/**
 * Prefetch card destinations on pointer/touch.
 * @param {ParentNode} root
 */
export function bindPrefetch(root) {
  const cards = root.querySelectorAll('a.home-card, a.service-card, a.gcard');
  cards.forEach((card) => {
    const href = card.getAttribute('href');
    if (!href) return;

    const prefetch = () => prefetchHref(href);
    card.addEventListener('pointerenter', prefetch, { passive: true });
    card.addEventListener('touchstart', prefetch, { passive: true });
  });
}

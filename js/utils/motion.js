/**
 * @returns {boolean}
 */
export function prefersReducedMotion() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Smooth-scroll to a section unless the user prefers reduced motion.
 * @param {HTMLElement|null} el
 */
export function scrollToSection(el) {
  if (!(el instanceof HTMLElement)) return;
  if (prefersReducedMotion()) return;
  requestAnimationFrame(() => {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

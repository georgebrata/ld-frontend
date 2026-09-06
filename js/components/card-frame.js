const CARD_SVG_PATH =
  'M604 0l12681 0c332,0 604,272 604,604l0 18237c0,332 -272,603 -604,603l-12681 0c-332,0 -604,-271 -604,-603l0 -18237c0,-332 272,-604 604,-604zm4546 1389l1100 0c0,-384 311,-695 695,-695 383,0 694,311 694,695l1100 0c222,0 404,182 404,405l0 0c0,223 -182,405 -404,405l-3589 0c-222,0 -405,-182 -405,-405l0 0c0,-223 183,-405 405,-405z';

/**
 * Create gift-card frame SVG element.
 * @returns {SVGElement}
 */
export function createCardFrameSvg() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  svg.setAttribute('viewBox', '0 0 13889 19444');
  svg.style.fill = '#fff';

  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('class', 'svgcolor');
  path.setAttribute('d', CARD_SVG_PATH);
  g.appendChild(path);
  svg.appendChild(g);
  return svg;
}

/**
 * Format price for card display.
 * @param {number|null} price
 * @returns {string}
 */
export function formatCardPrice(price) {
  if (price == null) return 'Price at checkout';
  return `$${price} per 1k`;
}

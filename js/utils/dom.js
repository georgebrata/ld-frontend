/**
 * Safely set text content on an element.
 * @param {Element|null} el
 * @param {string} text
 */
export function setText(el, text) {
  if (el) el.textContent = text;
}

/**
 * Create an element with optional attributes and text.
 * @param {string} tag
 * @param {Record<string, string>} [attrs]
 * @param {string} [text]
 * @returns {HTMLElement}
 */
export function createEl(tag, attrs = {}, text = '') {
  const el = document.createElement(tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (key === 'className') el.className = value;
    else el.setAttribute(key, value);
  });
  if (text) el.textContent = text;
  return el;
}

/**
 * Clear all children from a node.
 * @param {Element} parent
 */
export function clearChildren(parent) {
  while (parent.firstChild) parent.removeChild(parent.firstChild);
}

/**
 * Resolve asset path from the site root.
 * @param {string} assetPath
 * @returns {string}
 */
export function assetPath(assetPath) {
  const clean = String(assetPath ?? '').replace(/^\.\//, '').replace(/^\//, '');
  return `/${clean}`;
}

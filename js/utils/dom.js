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
 * Resolve asset path relative to site root.
 * @param {string} assetPath
 * @returns {string}
 */
export function assetPath(assetPath) {
  const depth = (window.location.pathname.match(/\//g) || []).length - 1;
  const prefix = depth > 1 ? '../'.repeat(depth - 1) : depth === 1 ? '../' : './';
  return `${prefix}${assetPath.replace(/^\.\//, '')}`;
}

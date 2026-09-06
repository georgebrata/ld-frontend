import { createEl, clearChildren } from '../utils/dom.js';

/**
 * Render loading state.
 * @param {HTMLElement} container
 * @param {string} [message='Loading services…']
 */
export function renderLoading(container, message = 'Loading services…') {
  clearChildren(container);
  const state = createEl('div', { className: 'catalogue-state', role: 'status' });
  state.appendChild(createEl('div', { className: 'lds-ripple' }));
  const ripple = state.querySelector('.lds-ripple');
  if (ripple) {
    ripple.appendChild(createEl('div'));
    ripple.appendChild(createEl('div'));
  }
  state.appendChild(createEl('p', {}, message));
  container.appendChild(state);
}

/**
 * Render empty state.
 * @param {HTMLElement} container
 * @param {string} [message='No services are currently available.']
 */
export function renderEmpty(container, message = 'No services are currently available.') {
  clearChildren(container);
  const state = createEl('div', { className: 'catalogue-state' });
  state.appendChild(createEl('p', {}, message));
  container.appendChild(state);
}

/**
 * Render error state with retry.
 * @param {HTMLElement} container
 * @param {() => void} onRetry
 * @param {string} [message="We couldn't load our services."]
 */
export function renderError(container, onRetry, message = "We couldn't load our services.") {
  clearChildren(container);
  const state = createEl('div', { className: 'catalogue-state' });
  state.appendChild(createEl('p', {}, message));
  const retryBtn = createEl('button', { className: 'btn', type: 'button' }, 'Try again');
  retryBtn.addEventListener('click', onRetry);
  state.appendChild(retryBtn);
  container.appendChild(state);
}

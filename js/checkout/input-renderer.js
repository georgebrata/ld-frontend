import { CONFIG } from '../config.js';
import { validateInput } from '../utils/validation.js';
import { createEl } from '../utils/dom.js';

/** @type {Record<string, { label: string, type: string, placeholder?: string, hint?: string }>} */
const INPUT_REGISTRY = {
  url: {
    label: 'Post URL',
    type: 'url',
    placeholder: 'https://instagram.com/p/...',
    hint: 'Link to the post you want to boost.',
  },
  username: {
    label: 'Username',
    type: 'text',
    placeholder: '@yourusername',
    hint: 'Your profile username without @.',
  },
  commentsList: {
    label: 'Comments',
    type: 'textarea',
    placeholder: 'One comment per line',
    hint: 'Enter each comment on a new line.',
  },
  email: {
    label: 'Email',
    type: 'email',
    placeholder: 'you@example.com',
    hint: 'We will send your confirmation here.',
  },
  quantity: {
    label: 'Quantity',
    type: 'number',
    placeholder: String(CONFIG.DEFAULT_QUANTITY),
    hint: 'Minimum 1,000.',
  },
};

/**
 * Parse inputs string into array of types.
 * @param {string|string[]} raw
 * @returns {string[]}
 */
export function parseInputs(raw) {
  if (Array.isArray(raw)) return raw;
  if (!raw || !String(raw).trim()) return [];
  return String(raw)
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Render a single form field for an input type.
 * @param {string} type
 * @param {HTMLElement} container
 * @returns {{ field: HTMLElement, input: HTMLInputElement|HTMLTextAreaElement, errorEl: HTMLElement }}
 */
export function renderInput(type, container) {
  const config = INPUT_REGISTRY[type] ?? {
    label: type.charAt(0).toUpperCase() + type.slice(1),
    type: 'text',
    placeholder: '',
  };

  const field = createEl('div', { className: 'form-field', 'data-input-type': type });
  const id = `checkout-${type}-${Math.random().toString(36).slice(2, 8)}`;

  const label = createEl('label', { for: id }, config.label);
  field.appendChild(label);

  /** @type {HTMLInputElement|HTMLTextAreaElement} */
  let input;

  if (config.type === 'textarea') {
    input = /** @type {HTMLTextAreaElement} */ (createEl('textarea', { id, name: type }));
    if (config.placeholder) input.placeholder = config.placeholder;
  } else {
    const inputType = config.type === 'number' ? 'number' : config.type;
    input = /** @type {HTMLInputElement} */ (
      createEl('input', { id, name: type, type: inputType })
    );
    if (config.placeholder) input.placeholder = config.placeholder;
    if (type === 'quantity') {
      input.min = String(CONFIG.QUANTITY_MIN);
      input.step = String(CONFIG.QUANTITY_STEP);
      input.value = String(CONFIG.DEFAULT_QUANTITY);
    }
  }

  input.setAttribute('aria-required', 'true');
  field.appendChild(input);

  if (config.hint) {
    const hint = createEl('span', { className: 'visually-hidden', id: `${id}-hint` }, config.hint);
    field.appendChild(hint);
    input.setAttribute('aria-describedby', `${id}-hint ${id}-error`);
  } else {
    input.setAttribute('aria-describedby', `${id}-error`);
  }

  const errorEl = createEl('span', {
    className: 'form-error',
    id: `${id}-error`,
    role: 'alert',
  });
  errorEl.hidden = true;
  field.appendChild(errorEl);

  container.appendChild(field);

  return { field, input, errorEl };
}

/**
 * Validate and show error on a field.
 * @param {string} type
 * @param {HTMLInputElement|HTMLTextAreaElement} input
 * @param {HTMLElement} field
 * @param {HTMLElement} errorEl
 * @returns {boolean}
 */
export function validateField(type, input, field, errorEl) {
  const result = validateInput(type, input.value);
  if (!result.valid) {
    field.classList.add('form-field--error');
    errorEl.textContent = result.message ?? 'Invalid value';
    errorEl.hidden = false;
    return false;
  }
  field.classList.remove('form-field--error');
  errorEl.textContent = '';
  errorEl.hidden = true;
  return true;
}

/**
 * Collect values from rendered service inputs (excludes email/quantity).
 * @param {HTMLElement} form
 * @param {string[]} serviceInputTypes
 * @returns {Record<string, string>}
 */
export function collectServiceInputValues(form, serviceInputTypes) {
  /** @type {Record<string, string>} */
  const values = {};
  serviceInputTypes.forEach((type) => {
    const input = /** @type {HTMLInputElement|HTMLTextAreaElement|null} */ (
      form.querySelector(`[name="${type}"]`)
    );
    if (input) values[type] = input.value.trim();
  });
  return values;
}

export { INPUT_REGISTRY };

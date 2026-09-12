import { CONFIG } from '../config.js';
import { canonicalInputName } from '../utils/inputs.js';
import { validateInput } from '../utils/validation.js';
import { createEl } from '../utils/dom.js';

/** @type {Record<string, { label: string, type: string, placeholder?: string, hint?: string }>} */
const INPUT_REGISTRY = {
  url: {
    label: 'Post URL',
    type: 'url',
    placeholder: 'https://instagram.com/p/...',
    hint: 'Link to the public post you want to boost.',
  },
  username: {
    label: 'Username',
    type: 'text',
    placeholder: '@yourusername',
    hint: 'Your public profile username. We never ask for a password.',
  },
  comments: {
    label: 'Comments',
    type: 'textarea',
    placeholder: 'One comment per line',
    hint: 'Enter each comment on a new line. Empty lines are ignored.',
  },
  usernames: {
    label: 'Usernames',
    type: 'textarea',
    placeholder: 'One username per line',
    hint: 'One username per line.',
  },
  hashtags: {
    label: 'Hashtags',
    type: 'textarea',
    placeholder: 'One hashtag per line',
    hint: 'One hashtag per line.',
  },
  hashtag: {
    label: 'Hashtag',
    type: 'text',
    placeholder: 'hashtag',
    hint: 'Hashtag without #.',
  },
  media: {
    label: 'Media URL',
    type: 'url',
    placeholder: 'https://…',
    hint: 'Link to the media used for this service.',
  },
  groups: {
    label: 'Groups',
    type: 'textarea',
    placeholder: 'One group per line',
    hint: 'One group per line.',
  },
  email: {
    label: 'Confirmation email',
    type: 'email',
    placeholder: 'you@example.com',
    hint: 'We will send a confirmation here after your payment is confirmed.',
  },
  quantity: {
    label: 'Quantity',
    type: 'number',
    placeholder: '1000',
    hint: 'Choose how many you want. Limits are shown below.',
  },
  runs: {
    label: 'Runs',
    type: 'number',
    placeholder: '2',
    hint: 'How many times this order should run.',
  },
  interval: {
    label: 'Interval (minutes)',
    type: 'number',
    placeholder: '60',
    hint: 'Minutes between runs.',
  },
  country: {
    label: 'Country',
    type: 'text',
    placeholder: 'US',
    hint: 'Country for this traffic or audience.',
  },
  device: {
    label: 'Device',
    type: 'text',
    placeholder: 'Mobile',
    hint: 'Device type for this order.',
  },
  type_of_traffic: {
    label: 'Traffic type',
    type: 'text',
    placeholder: 'Organic',
    hint: 'Kind of traffic to send.',
  },
  google_keyword: {
    label: 'Google keyword',
    type: 'text',
    placeholder: 'keyword',
    hint: 'Search keyword for this order.',
  },
  referring_url: {
    label: 'Referring URL',
    type: 'url',
    placeholder: 'https://…',
    hint: 'Where this traffic should appear to come from.',
  },
};

/**
 * @param {string|string[]} raw
 * @returns {string[]}
 */
export function parseInputs(raw) {
  if (Array.isArray(raw)) return raw.map((item) => canonicalInputName(item) || String(item));
  if (!raw || !String(raw).trim()) return [];
  return String(raw)
    .split(',')
    .map((s) => canonicalInputName(s))
    .filter(Boolean);
}

/**
 * @param {string} type
 * @param {HTMLElement} container
 * @param {{ min?: number, max?: number, step?: number, value?: number|string, platform?: string, overrides?: { label?: string, placeholder?: string, hint?: string } }} [options]
 */
export function renderInput(type, container, options = {}) {
  const canonical = canonicalInputName(type) || type;
  const config = {
    ...(INPUT_REGISTRY[canonical] ?? {
      label: canonical.charAt(0).toUpperCase() + canonical.slice(1),
      type: 'text',
      placeholder: '',
    }),
    ...(options.overrides || {}),
  };

  const field = createEl('div', { className: 'form-field', 'data-input-type': canonical });
  const id = `checkout-${canonical}-${Math.random().toString(36).slice(2, 8)}`;
  field.appendChild(createEl('label', { for: id }, config.label));

  /** @type {HTMLInputElement|HTMLTextAreaElement} */
  let input;
  if (config.type === 'textarea') {
    input = /** @type {HTMLTextAreaElement} */ (createEl('textarea', { id, name: canonical }));
    if (config.placeholder) input.placeholder = config.placeholder;
  } else {
    input = /** @type {HTMLInputElement} */ (createEl('input', { id, name: canonical, type: config.type }));
    if (config.placeholder) input.placeholder = config.placeholder;
    if (canonical === 'quantity') {
      const min = options.min ?? 1;
      const max = options.max ?? 10_000_000;
      const step = options.step ?? 1;
      input.min = String(min);
      input.max = String(max);
      input.step = String(step);
      if (options.value != null) input.value = String(options.value);
    }
    if (canonical === 'username') {
      input.autocomplete = 'username';
      input.spellcheck = false;
    }
    if (canonical === 'email') {
      input.autocomplete = 'email';
      input.maxLength = CONFIG.EMAIL_MAX_LENGTH;
    }
    if (options.value != null && canonical !== 'quantity') input.value = String(options.value);
  }

  input.setAttribute('aria-required', 'true');
  field.appendChild(input);

  if (config.hint) {
    const hint = createEl('span', { className: 'field-hint', id: `${id}-hint` }, config.hint);
    field.appendChild(hint);
    input.setAttribute('aria-describedby', `${id}-hint ${id}-error`);
  } else {
    input.setAttribute('aria-describedby', `${id}-error`);
  }

  const errorEl = createEl('span', { className: 'form-error', id: `${id}-error`, role: 'alert' });
  errorEl.hidden = true;
  field.appendChild(errorEl);
  container.appendChild(field);
  return { field, input, errorEl };
}

/**
 * @param {string} type
 * @param {HTMLInputElement|HTMLTextAreaElement} input
 * @param {HTMLElement} field
 * @param {HTMLElement} errorEl
 * @param {{ min?: number, max?: number, step?: number, platform?: string }} [options]
 */
export function validateField(type, input, field, errorEl, options = {}) {
  const canonical = canonicalInputName(type) || type;
  const value = canonical === 'username' ? String(input.value ?? '').replace(/^@/, '') : input.value;
  const result = validateInput(canonical, value, options);
  if (!result.valid) {
    field.classList.add('form-field--error');
    errorEl.textContent = result.message ?? 'Invalid value';
    errorEl.hidden = false;
    input.setAttribute('aria-invalid', 'true');
    return false;
  }
  field.classList.remove('form-field--error');
  errorEl.textContent = '';
  errorEl.hidden = true;
  input.removeAttribute('aria-invalid');
  return true;
}

/**
 * @param {HTMLElement} form
 * @param {string[]} serviceInputTypes
 */
export function collectServiceInputValues(form, serviceInputTypes) {
  /** @type {Record<string, string>} */
  const values = {};
  serviceInputTypes.forEach((type) => {
    const canonical = canonicalInputName(type) || type;
    const input = /** @type {HTMLInputElement|HTMLTextAreaElement|null} */ (
      form.querySelector(`[name="${canonical}"]`)
    );
    if (input) values[canonical] = input.value;
  });
  return values;
}

export { INPUT_REGISTRY };

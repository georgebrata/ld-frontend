import { CONFIG } from '../config.js';
import { canonicalInputName, normalizeNewlineList } from './inputs.js';
import { validatePlatformUrl } from './urls.js';

/** @typedef {{ valid: boolean, message?: string }} ValidationResult */

const USERNAME_PATTERN = /^[a-zA-Z0-9._]{1,30}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validate a single input value by canonical type.
 * @param {string} type
 * @param {string} value
 * @param {{ min?: number, max?: number, step?: number, platform?: string }} [options]
 * @returns {ValidationResult}
 */
export function validateInput(type, value, options = {}) {
  const canonical = canonicalInputName(type) || type;
  const trimmed = String(value ?? '').trim();

  switch (canonical) {
    case 'url': {
      const check = validatePlatformUrl(value, options.platform);
      if (!check.ok) return { valid: false, message: check.error };
      return { valid: true };
    }

    case 'username': {
      const username = trimmed.replace(/^@/, '');
      if (!username) return { valid: false, message: 'Please enter a username.' };
      if (!USERNAME_PATTERN.test(username)) {
        return { valid: false, message: 'Username must be 1–30 characters (letters, numbers, . or _).' };
      }
      return { valid: true };
    }

    case 'comments': {
      const list = normalizeNewlineList(value);
      if (!list.count) return { valid: false, message: 'Please enter at least one comment.' };
      if (list.text.length > 8000) {
        return { valid: false, message: 'Comments must be 8,000 characters or fewer.' };
      }
      return { valid: true };
    }

    case 'email':
      if (!trimmed) return { valid: false, message: 'Please enter your email.' };
      if (trimmed.length > CONFIG.EMAIL_MAX_LENGTH) {
        return { valid: false, message: 'Please enter a shorter email address.' };
      }
      if (!EMAIL_PATTERN.test(trimmed)) {
        return { valid: false, message: 'Please enter a valid email address.' };
      }
      return { valid: true };

    case 'quantity': {
      const min = Number.isInteger(options.min) ? options.min : 1;
      const max = Number.isInteger(options.max) ? options.max : 10_000_000;
      const num = Number(trimmed);
      if (!Number.isInteger(num)) {
        return { valid: false, message: 'Quantity must be a whole number.' };
      }
      if (num < min) {
        return { valid: false, message: `Quantity must be at least ${min.toLocaleString('en-US')}.` };
      }
      if (num > max) {
        return { valid: false, message: `Quantity cannot exceed ${max.toLocaleString('en-US')}.` };
      }
      const step = Number.isInteger(options.step) && options.step > 1 ? options.step : 1;
      if (step > 1 && num % step !== 0) {
        return { valid: false, message: `Quantity must increase in steps of ${step.toLocaleString('en-US')}.` };
      }
      return { valid: true };
    }

    default:
      if (!trimmed) return { valid: false, message: 'This field is required.' };
      return { valid: true };
  }
}

/**
 * @param {string} rawId
 * @param {string} [prefix='LD-']
 */
export function formatOrderId(rawId, prefix = 'LD-') {
  if (!rawId) return '';
  const short = String(rawId).replace(/-/g, '').slice(-6).toUpperCase();
  return `${prefix}${short}`;
}

import { CONFIG } from '../config.js';

/** @typedef {{ valid: boolean, message?: string }} ValidationResult */

const URL_PATTERN = /^https?:\/\/.+/i;
const USERNAME_PATTERN = /^[a-zA-Z0-9._]{1,30}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validate a single input value by type.
 * @param {string} type
 * @param {string} value
 * @param {{ min?: number, max?: number }} [options]
 * @returns {ValidationResult}
 */
export function validateInput(type, value, options = {}) {
  const trimmed = String(value ?? '').trim();

  switch (type) {
    case 'url':
      if (!trimmed) return { valid: false, message: 'Please enter a URL.' };
      if (!URL_PATTERN.test(trimmed)) {
        return { valid: false, message: 'Please enter a valid http(s) URL.' };
      }
      return { valid: true };

    case 'username': {
      const username = trimmed.replace(/^@/, '');
      if (!username) return { valid: false, message: 'Please enter a username.' };
      if (!USERNAME_PATTERN.test(username)) {
        return { valid: false, message: 'Username must be 1–30 characters (letters, numbers, . or _).' };
      }
      return { valid: true };
    }

    case 'commentsList':
      if (!trimmed) return { valid: false, message: 'Please enter at least one comment.' };
      if (trimmed.length > 2000) {
        return { valid: false, message: 'Comments must be 2,000 characters or fewer.' };
      }
      return { valid: true };

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
      const min = Number.isInteger(options.min) ? options.min : CONFIG.QUANTITY_MIN;
      const max = Number.isInteger(options.max) ? options.max : CONFIG.QUANTITY_MAX;
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
      return { valid: true };
    }

    default:
      if (!trimmed) return { valid: false, message: 'This field is required.' };
      return { valid: true };
  }
}

/**
 * Format a display order ID.
 * @param {string} rawId
 * @param {string} [prefix='LD-']
 * @returns {string}
 */
export function formatOrderId(rawId, prefix = 'LD-') {
  if (!rawId) return '';
  const short = String(rawId).replace(/-/g, '').slice(-6).toUpperCase();
  return `${prefix}${short}`;
}

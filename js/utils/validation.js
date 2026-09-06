/** @typedef {{ valid: boolean, message?: string }} ValidationResult */

const URL_PATTERN = /^https?:\/\/.+/i;
const USERNAME_PATTERN = /^[a-zA-Z0-9._]{1,30}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validate a single input value by type.
 * @param {string} type
 * @param {string} value
 * @returns {ValidationResult}
 */
export function validateInput(type, value) {
  const trimmed = String(value ?? '').trim();

  switch (type) {
    case 'url':
      if (!trimmed) return { valid: false, message: 'Please enter a URL.' };
      if (!URL_PATTERN.test(trimmed)) return { valid: false, message: 'Please enter a valid http(s) URL.' };
      return { valid: true };

    case 'username':
      if (!trimmed) return { valid: false, message: 'Please enter a username.' };
      if (!USERNAME_PATTERN.test(trimmed)) {
        return { valid: false, message: 'Username must be 1–30 characters (letters, numbers, . or _).' };
      }
      return { valid: true };

    case 'commentsList':
      if (!trimmed) return { valid: false, message: 'Please enter at least one comment.' };
      if (trimmed.length > 500) return { valid: false, message: 'Comments must be 500 characters or fewer.' };
      return { valid: true };

    case 'email':
      if (!trimmed) return { valid: false, message: 'Please enter your email.' };
      if (!EMAIL_PATTERN.test(trimmed)) return { valid: false, message: 'Please enter a valid email address.' };
      return { valid: true };

    case 'quantity': {
      const num = Number(trimmed);
      if (!Number.isInteger(num) || num < 1000) {
        return { valid: false, message: 'Quantity must be at least 1,000.' };
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
  const short = rawId.replace(/-/g, '').slice(-6).toUpperCase();
  return `${prefix}${short}`;
}

/**
 * Guest checkout capability token (32 random bytes) bound server-side by hash.
 * Kept in sessionStorage across Stripe redirects. Never put in query strings.
 */

const ATTEMPT_KEY = 'ld.checkoutAttemptId';
const TOKEN_KEY = 'ld.capabilityToken';
const DRAFT_KEY = 'ld.checkoutDraft';
const FINGERPRINT_KEY = 'ld.checkoutFingerprint';

function bytesToB64Url(bytes) {
  let bin = '';
  bytes.forEach((b) => {
    bin += String.fromCharCode(b);
  });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function storageAvailable() {
  try {
    const key = 'ld.storageProbe';
    sessionStorage.setItem(key, '1');
    sessionStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {object} draft
 */
export function draftFingerprint(draft) {
  return JSON.stringify({
    serviceId: draft?.serviceId || '',
    quantity: draft?.quantity ?? null,
    email: String(draft?.email || '').trim().toLowerCase(),
    inputs: draft?.inputs || {},
  });
}

function newCapability() {
  const attemptId = crypto.randomUUID();
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return { attemptId, token: bytesToB64Url(bytes) };
}

/**
 * @param {string} [fingerprint]
 * @returns {{ attemptId: string, token: string, rotated?: boolean }}
 */
export function getOrCreateCapability(fingerprint) {
  if (!storageAvailable()) {
    const err = new Error('This browser blocked session storage, which is required for checkout.');
    err.code = 'storage_unavailable';
    throw err;
  }
  let attemptId = sessionStorage.getItem(ATTEMPT_KEY);
  let token = sessionStorage.getItem(TOKEN_KEY);
  const storedFp = sessionStorage.getItem(FINGERPRINT_KEY) || '';
  let rotated = false;
  if (fingerprint && storedFp && storedFp !== fingerprint) {
    attemptId = '';
    token = '';
    rotated = true;
  }
  if (!attemptId || !token) {
    const next = newCapability();
    attemptId = next.attemptId;
    token = next.token;
    sessionStorage.setItem(ATTEMPT_KEY, attemptId);
    sessionStorage.setItem(TOKEN_KEY, token);
    rotated = true;
  }
  if (fingerprint) sessionStorage.setItem(FINGERPRINT_KEY, fingerprint);
  return { attemptId, token, rotated };
}

export function rotateCapability(fingerprint) {
  if (!storageAvailable()) {
    const err = new Error('This browser blocked session storage, which is required for checkout.');
    err.code = 'storage_unavailable';
    throw err;
  }
  const next = newCapability();
  sessionStorage.setItem(ATTEMPT_KEY, next.attemptId);
  sessionStorage.setItem(TOKEN_KEY, next.token);
  if (fingerprint) sessionStorage.setItem(FINGERPRINT_KEY, fingerprint);
  return next;
}

export function readCapability() {
  try {
    return {
      attemptId: sessionStorage.getItem(ATTEMPT_KEY) || '',
      token: sessionStorage.getItem(TOKEN_KEY) || '',
    };
  } catch {
    return { attemptId: '', token: '' };
  }
}

/**
 * @param {object} draft
 */
export function saveCheckoutDraft(draft) {
  if (!storageAvailable()) return;
  sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  if (draft) sessionStorage.setItem(FINGERPRINT_KEY, draftFingerprint(draft));
}

export function readCheckoutDraft() {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearCheckoutSession() {
  try {
    sessionStorage.removeItem(ATTEMPT_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(DRAFT_KEY);
    sessionStorage.removeItem(FINGERPRINT_KEY);
  } catch {
    /* private mode */
  }
}

/**
 * Deep-link back to the saved platform/service. Tokens stay out of the URL.
 * @param {{ platform?: string, slug?: string, url?: string }|null} draft
 * @returns {string}
 */
export function retryCheckoutHref(draft) {
  const path = String(draft?.url || '');
  if (path.startsWith('/') && !path.startsWith('//')) return path;
  if (!draft?.platform) return '/';
  return `/${draft.platform}/${draft.slug ? `${draft.slug}/` : ''}`;
}

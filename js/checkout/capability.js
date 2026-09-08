/**
 * Guest checkout capability token (32 random bytes) bound server-side by hash.
 * Kept in sessionStorage across Stripe redirects. Never put in query strings.
 */

const ATTEMPT_KEY = 'ld.checkoutAttemptId';
const TOKEN_KEY = 'ld.capabilityToken';
const DRAFT_KEY = 'ld.checkoutDraft';

function bytesToB64Url(bytes) {
  let bin = '';
  bytes.forEach((b) => {
    bin += String.fromCharCode(b);
  });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * @returns {{ attemptId: string, token: string }}
 */
export function getOrCreateCapability(serviceId) {
  let attemptId = sessionStorage.getItem(ATTEMPT_KEY);
  let token = sessionStorage.getItem(TOKEN_KEY);
  const draft = readCheckoutDraft();
  if (serviceId && draft?.serviceId && draft.serviceId !== serviceId) {
    attemptId = '';
    token = '';
  }
  if (!attemptId || !token) {
    attemptId = crypto.randomUUID();
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    token = bytesToB64Url(bytes);
    sessionStorage.setItem(ATTEMPT_KEY, attemptId);
    sessionStorage.setItem(TOKEN_KEY, token);
  }
  return { attemptId, token };
}

export function readCapability() {
  return {
    attemptId: sessionStorage.getItem(ATTEMPT_KEY) || '',
    token: sessionStorage.getItem(TOKEN_KEY) || '',
  };
}

/**
 * @param {object} draft
 */
export function saveCheckoutDraft(draft) {
  sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
}

export function readCheckoutDraft() {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Deep-link back to the saved platform/service. Tokens stay out of the URL.
 * @param {{ platform?: string, slug?: string }|null} draft
 * @returns {string}
 */
export function retryCheckoutHref(draft) {
  const path = String(draft?.url || '');
  if (path.startsWith('/') && !path.startsWith('//')) return path;
  if (!draft?.platform) return '/';
  const params = new URLSearchParams();
  params.set('platform', draft.platform);
  if (draft.slug) params.set('service', draft.slug);
  return `/?${params.toString()}`;
}

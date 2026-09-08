/**
 * Application configuration. Secrets never belong here.
 * Public Stripe, Resend, SocialPanel24, and service-role keys stay on the server.
 *
 * @type {Readonly<{
 *   SITE_URL: string,
 *   SUPABASE_URL: string,
 *   SUPABASE_ANON_KEY: string,
 *   SUPABASE_FUNCTIONS_URL: string,
 *   ORDER_ID_PREFIX: string,
 *   FETCH_TIMEOUT_MS: number,
 *   EMAIL_MAX_LENGTH: number,
 *   ANALYTICS_ENABLED: boolean,
 *   ANALYTICS_CONSENT_KEY: string
 * }>}
 */
export const CONFIG = Object.freeze({
  SITE_URL: 'https://like-dealer.com',
  SUPABASE_URL: 'https://xvrvxofujpqavgnprpmq.supabase.co',
  SUPABASE_ANON_KEY:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh2cnZ4b2Z1anBxYXZnbnBycG1xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4ODU4NTMsImV4cCI6MjEwNDQ2MTg1M30.MdWt3ClVrR82JnQmGtGJxVxXPD42-1iJ7rpP7cT-dVI',
  SUPABASE_FUNCTIONS_URL: 'https://xvrvxofujpqavgnprpmq.supabase.co/functions/v1',
  ORDER_ID_PREFIX: 'LD-',
  FETCH_TIMEOUT_MS: 15000,
  EMAIL_MAX_LENGTH: 254,
  ANALYTICS_ENABLED: false,
  ANALYTICS_CONSENT_KEY: 'ld.analyticsConsent',
});

/**
 * Edge Function origin.
 * @returns {string}
 */
export function functionsBaseUrl() {
  if (CONFIG.SUPABASE_FUNCTIONS_URL) return CONFIG.SUPABASE_FUNCTIONS_URL.replace(/\/$/, '');
  if (CONFIG.SUPABASE_URL) return `${CONFIG.SUPABASE_URL.replace(/\/$/, '')}/functions/v1`;
  return '';
}

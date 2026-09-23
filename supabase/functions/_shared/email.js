/**
 * Resend adapter. Idempotency keys last 24 hours; local sent records are kept
 * longer and ambiguous attempts outside that window must be reconciled first.
 */

import { logError } from './log.js';
import { fetchWithTimeout } from './http.js';

const RESEND_URL = 'https://api.resend.com/emails';
export const RESEND_IDEMPOTENCY_HOURS = 24;
const RESEND_TIMEOUT_MS = 15000;

/**
 * @param {object} env
 * @param {{
 *   to: string,
 *   subject: string,
 *   html: string,
 *   text: string,
 *   idempotencyKey: string
 * }} message
 * @param {typeof fetch} [fetchImpl]
 */
export async function sendResendEmail(env, message, fetchImpl = fetch) {
  const timeoutMs = Number(env.RESEND_TIMEOUT_MS || RESEND_TIMEOUT_MS);
  const response = await fetchWithTimeout(
    fetchImpl,
    RESEND_URL,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': message.idempotencyKey,
      },
      body: JSON.stringify({
        from: env.FROM_NAME ? `${env.FROM_NAME} <${env.FROM_EMAIL}>` : env.FROM_EMAIL,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        reply_to: env.REPLY_TO_EMAIL || env.FROM_EMAIL,
      }),
    },
    timeoutMs
  );

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    logError('resend failed', { status: response.status });
    const err = new Error(`Resend HTTP ${response.status}`);
    err.status = response.status;
    err.retryable = response.status >= 500 || response.status === 429;
    throw err;
  }
  return { id: String(json.id || ''), raw: json };
}

/**
 * "Accepted for sending" is not delivery. We store accepted + resend id.
 * @param {Date} sentAt
 * @param {Date} now
 */
export function resendIdempotencyExpired(sentAt, now) {
  const delta = now.getTime() - sentAt.getTime();
  return delta > RESEND_IDEMPOTENCY_HOURS * 60 * 60 * 1000;
}

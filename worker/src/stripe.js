/**
 * @param {Record<string, string>} params
 */
function formBody(params) {
  const body = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value != null && value !== '') body.set(key, String(value));
  });
  return body;
}

/**
 * @param {Record<string, string>} env
 * @param {object} order
 * @param {number} amountCents
 */
export async function createCheckoutSession(env, order, amountCents) {
  const success = `${env.SITE_URL.replace(/\/$/, '')}/success/?session_id={CHECKOUT_SESSION_ID}`;
  const cancel = `${env.SITE_URL.replace(/\/$/, '')}/cancel/`;

  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formBody({
      mode: 'payment',
      customer_email: order.customerEmail,
      success_url: success,
      cancel_url: cancel,
      client_reference_id: order.id,
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': String(amountCents),
      'line_items[0][price_data][product_data][name]': order.service,
      'metadata[internalOrderId]': order.id,
      'metadata[serviceId]': order.serviceId,
      'payment_intent_data[metadata][internalOrderId]': order.id,
    }),
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json.url) {
    throw new Error('Could not start Stripe Checkout.');
  }
  return json;
}

/**
 * Verify Stripe-Signature using the raw body.
 * @param {string} rawBody
 * @param {string} header
 * @param {string} secret
 */
export async function verifyStripeSignature(rawBody, header, secret) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(
    header.split(',').map((item) => {
      const [k, ...rest] = item.split('=');
      return [k.trim(), rest.join('=')];
    })
  );
  const timestamp = parts.t;
  const expected = parts.v1;
  if (!timestamp || !expected) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signed = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`${timestamp}.${rawBody}`)
  );
  const digest = [...new Uint8Array(signed)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return timingSafeEqual(digest, expected);
}

/**
 * @param {string} a
 * @param {string} b
 */
export function timingSafeEqual(a, b) {
  const left = String(a);
  const right = String(b);
  if (left.length !== right.length) return false;
  let out = 0;
  for (let i = 0; i < left.length; i += 1) {
    out |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return out === 0;
}

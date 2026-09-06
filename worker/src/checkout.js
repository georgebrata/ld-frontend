import { json } from './http.js';
import { validateCheckoutBody } from './validate.js';
import { getVisibleService } from './services.js';
import { findSp24Service, getSp24Services, quoteFromSp24 } from './pricing.js';
import { createPendingOrder, getOrder, saveOrder, toPublicOrder } from './orders.js';
import { createCheckoutSession } from './stripe.js';

/**
 * @param {any} store
 * @param {Record<string, string>} env
 * @param {string} serviceId
 */
export async function handleCatalog(store, env, serviceId) {
  const service = await getVisibleService(env, serviceId);
  if (!service) return json({ error: 'Service not found.' }, 404);

  const markup = Number(env.MARKUP_MULTIPLIER || 2);
  let catalog = [];
  try {
    catalog = await getSp24Services(store, env);
  } catch {
    catalog = [];
  }
  const sp24 = findSp24Service(catalog, service.socialpanelId);
  const quote = quoteFromSp24(sp24, Number(sp24?.min || 1), markup);

  return json({
    serviceId: service.id,
    label: service.label,
    platform: service.platform,
    inputs: service.inputs,
    quantityMin: quote.quantityMin ?? Number(sp24?.min) ?? 1,
    quantityMax: quote.quantityMax ?? Number(sp24?.max) ?? 10000000,
    unitPriceInCents: quote.ok ? quote.unitPriceInCents : null,
    purchasable: Boolean(quote.ok),
  });
}

/**
 * @param {any} store
 * @param {Record<string, string>} env
 * @param {Record<string, unknown>} body
 */
export async function handleQuote(store, env, body) {
  const parsed = validateCheckoutBody({
    ...body,
    customerEmail: body.customerEmail || 'quote@example.com',
    inputs: body.inputs || {},
  });
  if (!parsed.ok) return json({ error: parsed.error }, 400);

  const priced = await priceOrder(store, env, parsed.serviceId, parsed.quantity);
  if (!priced.ok) return json({ error: priced.error }, priced.status || 400);
  return json({
    serviceId: parsed.serviceId,
    quantity: parsed.quantity,
    unitPriceInCents: priced.quote.unitPriceInCents,
    totalInCents: priced.quote.totalInCents,
  });
}

/**
 * @param {any} store
 * @param {Record<string, string>} env
 * @param {Record<string, unknown>} body
 */
export async function handleSession(store, env, body) {
  const parsed = validateCheckoutBody(body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);

  const priced = await priceOrder(store, env, parsed.serviceId, parsed.quantity);
  if (!priced.ok) return json({ error: priced.error }, priced.status || 400);

  const order = await createPendingOrder(store, env, {
    customerEmail: parsed.customerEmail,
    serviceId: priced.service.id,
    service: priced.service.label,
    platform: priced.service.platform,
    inputs: parsed.inputs,
    quantity: parsed.quantity,
    socialPanelId: priced.service.socialpanelId,
    amountCents: priced.quote.totalInCents,
  });

  const session = await createCheckoutSession(env, order, priced.quote.totalInCents);
  order.stripeSessionId = session.id;
  order.status = 'payment_pending';
  await saveOrder(store, env, order);

  return json({ checkoutUrl: session.url, orderId: order.id });
}

/**
 * @param {any} store
 * @param {string} id
 */
export async function handleGetOrder(store, id) {
  const order = await getOrder(store, id);
  if (!order) return json({ error: 'Order not found.' }, 404);
  return json({ order: toPublicOrder(order) });
}

/**
 * @param {any} store
 * @param {Record<string, string>} env
 * @param {string} serviceId
 * @param {number} quantity
 */
async function priceOrder(store, env, serviceId, quantity) {
  const service = await getVisibleService(env, serviceId);
  if (!service) return { ok: false, status: 404, error: 'That service is not available.' };
  if (!service.socialpanelId) {
    return { ok: false, status: 409, error: 'That service cannot be purchased right now.' };
  }

  const catalog = await getSp24Services(store, env);
  const sp24 = findSp24Service(catalog, service.socialpanelId);
  const quote = quoteFromSp24(sp24, quantity, Number(env.MARKUP_MULTIPLIER || 2));
  if (!quote.ok) return { ok: false, status: 400, error: quote.error };
  return { ok: true, service, sp24, quote };
}

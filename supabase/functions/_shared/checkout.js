/**
 * Create or reuse a Stripe Checkout Session. Prices are calculated server-side.
 */

import { hashCapabilityToken, timingSafeEqual } from './crypto-token.js';
import { getInternalService, getProviderCatalog, pricingEnv } from './catalogue.js';
import { findProviderService, quoteService } from './pricing.js';
import { serializeProviderAdd } from './provider-types.js';
import { validateCheckoutBody } from './validate.js';
import { createCheckoutSession, expireCheckoutSession, retrieveCheckoutSession } from './stripe.js';
import { formatDisplayId } from './states.js';

function paramsFingerprint(parsed, quote) {
  return JSON.stringify({
    serviceId: parsed.serviceId,
    quantity: parsed.quantity,
    email: parsed.customerEmail,
    inputs: parsed.inputs,
    amountMinor: quote.amountMinor,
    currency: quote.currency,
  });
}

function sameParams(order, fingerprint) {
  return order.params_fingerprint === fingerprint;
}

/**
 * @param {object} env
 * @param {object} store
 * @param {Record<string, unknown>} body
 * @param {object} [deps]
 */
export async function createGuestCheckout(env, store, body, deps = {}) {
  const parsed = validateCheckoutBody(body);
  if (!parsed.ok) return { status: 400, body: { error: parsed.error } };

  const tokenHash = await hashCapabilityToken(parsed.capabilityToken);
  const internal = await getInternalService(env, parsed.serviceId, deps);
  if (!internal || !internal.purchasable) {
    return { status: 409, body: { error: 'That service is not available to purchase right now.' } };
  }

  const checked = validateCheckoutBody({ ...body, capabilityToken: parsed.capabilityToken }, internal);
  if (!checked.ok) return { status: 400, body: { error: checked.error } };

  const money = pricingEnv(env);
  const providerCatalog = await getProviderCatalog(env, deps);
  const provider = findProviderService(providerCatalog, internal.socialpanelId);
  const quote = quoteService({
    retail: {
      id: internal.id,
      platform: internal.platform,
      visible: true,
      socialpanelId: internal.socialpanelId,
      rateUnit: internal.rateUnit,
      markupMultiplier: internal.markupMultiplier,
      quantityStep: internal.quantityStep,
      quantityDefault: internal.quantityDefault,
      packagePriceMinor: internal.packagePriceMinor,
    },
    provider,
    quantity: checked.quantity,
    inputs: checked.inputs,
    retailCurrency: money.retailCurrency,
    providerCurrency: money.providerCurrency,
    fxProviderToRetail: money.fxProviderToRetail,
    dripRuns: checked.drip?.runs,
  });

  if (!quote.ok) return { status: 400, body: { error: quote.error } };

  if (!env.STRIPE_SECRET_KEY) {
    return { status: 503, body: { error: 'Checkout is not configured yet.' } };
  }

  if (checked.expectedQuote && Number.isInteger(checked.expectedQuote.amountMinor)) {
    const currencyMatch =
      !checked.expectedQuote.currency ||
      checked.expectedQuote.currency === quote.currency;
    const amountMatch = checked.expectedQuote.amountMinor === quote.amountMinor;
    const versionMatch =
      !checked.expectedQuote.quoteVersion || checked.expectedQuote.quoteVersion === quote.quoteVersion;
    if (!currencyMatch || !amountMatch || !versionMatch) {
      return {
        status: 409,
        body: {
          error: 'The price changed. Review the updated total before paying.',
          code: 'quote_changed',
          quote: {
            amountMinor: quote.amountMinor,
            currency: quote.currency,
            quantity: quote.quantity,
            billableQuantity: quote.billableQuantity,
            quoteVersion: quote.quoteVersion,
            rateUnit: quote.rateUnit,
          },
        },
      };
    }
  }

  let providerPayload;
  try {
    providerPayload = serializeProviderAdd(internal.providerType, {
      platform: internal.platform,
      quantity: quote.billableQuantity,
      inputs: checked.inputs,
      drip: checked.drip,
    });
  } catch (err) {
    return { status: 400, body: { error: err instanceof Error ? err.message : 'Invalid order details.' } };
  }

  const fingerprint = paramsFingerprint(checked, quote);
  const existing = await store.getOrderByAttempt(checked.checkoutAttemptId);

  if (existing) {
    if (!timingSafeEqual(existing.capability_token_hash, tokenHash)) {
      return { status: 404, body: { error: 'Checkout attempt not found.' } };
    }
    if (existing.payment_status === 'paid') {
      return { status: 409, body: { error: 'This checkout attempt is already paid.' } };
    }
    if (!sameParams(existing, fingerprint)) {
      return { status: 409, body: { error: 'This checkout attempt was started with different details. Start again.' } };
    }
    if (existing.stripe_session_id) {
      const session = await retrieveCheckoutSession(env, existing.stripe_session_id, deps.fetchImpl);
      const open = session && ['open', 'unpaid'].includes(String(session.status)) && session.url;
      if (open && session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') {
        if (session.status === 'open') {
          return {
            status: 200,
            body: { checkoutUrl: session.url, orderId: existing.id, reused: true },
          };
        }
      }
      if (session && session.status === 'open') {
        await expireCheckoutSession(env, existing.stripe_session_id, deps.fetchImpl);
      }
      if (session && session.payment_status === 'paid') {
        return { status: 409, body: { error: 'This checkout attempt is already paid.' } };
      }
    }
  }

  const orderId = existing?.id || crypto.randomUUID();
  const revision = existing ? Number(existing.checkout_revision || 1) + (existing.stripe_session_id ? 1 : 0) : 1;
  const record = {
    id: orderId,
    display_id: existing?.display_id || formatDisplayId(orderId, env.ORDER_ID_PREFIX || 'LD-'),
    checkout_attempt_id: checked.checkoutAttemptId,
    capability_token_hash: tokenHash,
    email: checked.customerEmail,
    service_id: internal.id,
    service_snapshot: {
      id: internal.id,
      label: internal.label,
      platform: internal.platform,
      platformLabel: internal.platformLabel,
      service: internal.service,
      type: internal.providerType,
      inputs: internal.inputs,
      rateUnit: internal.rateUnit,
      currency: quote.currency,
      retailRateMinor: quote.retailRateMinor,
    },
    provider_service_id: internal.providerServiceId,
    provider_type: internal.providerType,
    provider_payload: providerPayload,
    quantity: checked.quantity,
    billable_quantity: quote.billableQuantity,
    currency: quote.currency,
    amount_minor: quote.amountMinor,
    quote_version: quote.quoteVersion,
    rate_unit: quote.rateUnit,
    retail_rate_minor: quote.retailRateMinor,
    markup: quote.markup,
    inputs: checked.inputs,
    payment_status: 'pending',
    fulfillment_status: 'not_started',
    checkout_revision: revision,
    params_fingerprint: fingerprint,
  };

  if (!existing) {
    await store.insertOrder(record);
  } else {
    await store.updateOrder(orderId, {
      quantity: record.quantity,
      billable_quantity: record.billable_quantity,
      amount_minor: record.amount_minor,
      quote_version: record.quote_version,
      provider_payload: record.provider_payload,
      inputs: record.inputs,
      checkout_revision: revision,
    });
  }

  const session = await createCheckoutSession(
    env,
    {
      id: orderId,
      email: checked.customerEmail,
      checkoutAttemptId: checked.checkoutAttemptId,
      serviceId: internal.id,
      serviceLabel: internal.label,
      storefrontOrigin: deps.storefrontOrigin || '',
    },
    {
      amountMinor: quote.amountMinor,
      currency: quote.currency,
      idempotencyKey: `ld-checkout-${checked.checkoutAttemptId}-r${revision}`,
    },
    deps.fetchImpl
  );

  await store.updateOrder(orderId, {
    stripe_session_id: session.id,
    payment_status: 'pending',
  });

  return {
    status: 200,
    body: {
      checkoutUrl: session.url,
      orderId,
      quote: {
        amountMinor: quote.amountMinor,
        currency: quote.currency,
        quantity: quote.quantity,
        billableQuantity: quote.billableQuantity,
        quoteVersion: quote.quoteVersion,
      },
    },
  };
}

/**
 * HTML/plain-text email templates. Values are escaped. Provider secrets and
 * costs never appear in customer copy.
 */

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const EMAIL_TEMPLATE_VERSION = '2026-09-08';

/**
 * @param {object} order
 * @param {{ amountLabel: string, supportEmail?: string, siteUrl?: string }} extras
 */
export function customerPaymentEmail(order, extras) {
  const displayId = order.displayId || order.display_id || order.id;
  const subject = `LikeDealer — Order #${displayId} payment received`;
  const support = extras.supportEmail || 'support@like-dealer.com';
  const payment = order.paymentStatus || order.payment_status || 'paid';
  const fulfillment = order.fulfillmentStatus || order.fulfillment_status || 'not_started';
  const text = [
    `Your payment has been received.`,
    `Order: ${displayId}`,
    `Service: ${order.serviceLabel || order.service}`,
    `Quantity: ${order.quantity}`,
    `Amount: ${extras.amountLabel}`,
    `Payment status: ${payment}`,
    `Fulfilment status: ${fulfillment}`,
    `This is a payment receipt, not a delivery confirmation.`,
    `Contact ${support} if you need help.`,
  ].join('\n');

  const html = `<!doctype html><html><body style="margin:0;background:#52555b;padding:24px;font-family:Arial,sans-serif;color:#1f2227;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;">
    <tr><td style="padding:28px 24px;">
      <p style="margin:0 0 8px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#50565b;">LikeDealer</p>
      <h1 style="margin:0 0 16px;font-size:24px;">Payment received</h1>
      <p>Your payment has been received. Fulfilment is processed separately and is not complete just because this email arrived.</p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:20px 0;background:#f5f5f5;border-radius:8px;">
        <tr><td style="padding:16px;font-size:14px;line-height:1.6;">
          <strong>Order</strong><br>${escapeHtml(displayId)}<br><br>
          <strong>Service</strong><br>${escapeHtml(order.serviceLabel || order.service)}<br><br>
          <strong>Quantity</strong><br>${escapeHtml(order.quantity)}<br><br>
          <strong>Amount</strong><br>${escapeHtml(extras.amountLabel)}<br><br>
          <strong>Payment</strong><br>${escapeHtml(payment)}<br><br>
          <strong>Fulfilment</strong><br>${escapeHtml(fulfillment)}
        </td></tr>
      </table>
      <p style="font-size:14px;color:#50565b;">Contact ${escapeHtml(support)} if you need help. This is a receipt, not a marketing message.</p>
    </td></tr>
  </table>
</body></html>`;

  return { subject, text, html, templateVersion: EMAIL_TEMPLATE_VERSION };
}

/**
 * @param {object} order
 * @param {{ amountLabel: string, reason?: string }} extras
 */
export function ownerPaymentEmail(order, extras) {
  const displayId = order.displayId || order.display_id || order.id;
  const subject = `LikeDealer — New paid order #${displayId}`;
  const text = [
    `New paid order`,
    `orderId: ${order.id}`,
    `displayId: ${displayId}`,
    `email: ${order.email || order.customerEmail}`,
    `service: ${order.serviceLabel || order.service}`,
    `serviceId: ${order.serviceId || order.service_id}`,
    `quantity: ${order.quantity}`,
    `amount: ${extras.amountLabel}`,
    `payment: ${order.paymentStatus || order.payment_status}`,
    `fulfilment: ${order.fulfillmentStatus || order.fulfillment_status}`,
    extras.reason ? `note: ${extras.reason}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;padding:24px;color:#1f2227;">
    <h1>New paid order ${escapeHtml(displayId)}</h1>
    <pre style="white-space:pre-wrap;font-size:13px;">${escapeHtml(text)}</pre>
  </body></html>`;

  return { subject, text, html, templateVersion: EMAIL_TEMPLATE_VERSION };
}

/**
 * @param {object} order
 * @param {string} alert
 */
export function ownerAlertEmail(order, alert) {
  const displayId = order.displayId || order.display_id || order.id;
  const subject = `LikeDealer — Operator alert for #${displayId}`;
  const text = [
    alert,
    `orderId: ${order.id}`,
    `displayId: ${displayId}`,
    `fulfilment: ${order.fulfillmentStatus || order.fulfillment_status}`,
    `providerOrderId: ${order.providerOrderId || order.provider_order_id || '(none)'}`,
  ].join('\n');
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;padding:24px;">
    <h1>${escapeHtml(subject)}</h1>
    <pre style="white-space:pre-wrap;">${escapeHtml(text)}</pre>
  </body></html>`;
  return { subject, text, html, templateVersion: EMAIL_TEMPLATE_VERSION };
}

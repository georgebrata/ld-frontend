import { formatUsd } from './money.js';

/**
 * @param {object} order
 */
export function customerEmail(order) {
  const subject = `LikeDealer — Order #${order.displayId || order.id} confirmed`;
  const amount = order.amountCents != null ? formatUsd(order.amountCents) : 'Paid';
  const text = [
    `Your payment has been received.`,
    `Order: ${order.displayId || order.id}`,
    `Service: ${order.service}`,
    `Platform: ${order.platform || ''}`,
    `Quantity: ${order.quantity}`,
    `Target: ${order.url || ''}`,
    `Amount paid: ${amount}`,
    `Payment status: paid`,
    `Fulfilment status: ${order.status}`,
    order.socialPanelOrderId ? `Reference: ${order.socialPanelOrderId}` : '',
    `Reply to this email if you need help.`,
  ]
    .filter(Boolean)
    .join('\n');

  const html = `<!doctype html><html><body style="margin:0;background:#52555b;padding:24px;font-family:Arial,sans-serif;color:#1f2227;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;">
    <tr><td style="padding:28px 24px;">
      <p style="margin:0 0 8px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#50565b;">LikeDealer</p>
      <h1 style="margin:0 0 16px;font-size:24px;">Order confirmed</h1>
      <p>Your payment has been received and your order is being processed.</p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:20px 0;background:#f5f5f5;border-radius:8px;">
        <tr><td style="padding:16px;font-size:14px;line-height:1.6;">
          <strong>Order</strong><br>${escapeHtml(order.displayId || order.id)}<br><br>
          <strong>Service</strong><br>${escapeHtml(order.service)}<br><br>
          <strong>Quantity</strong><br>${escapeHtml(order.quantity)}<br><br>
          <strong>Target</strong><br>${escapeHtml(order.url || '—')}<br><br>
          <strong>Amount paid</strong><br>${escapeHtml(amount)}<br><br>
          <strong>Status</strong><br>${escapeHtml(order.status)}
        </td></tr>
      </table>
      <p style="font-size:14px;color:#50565b;">This email is a receipt, not a marketing message. Contact support if you need help.</p>
    </td></tr>
  </table>
</body></html>`;

  return { subject, text, html };
}

/**
 * @param {object} order
 */
export function ownerEmail(order) {
  const subject = `LikeDealer — New paid order #${order.displayId || order.id}`;
  const text = [
    `New paid order`,
    `internalOrderId: ${order.id}`,
    `customerEmail: ${order.customerEmail}`,
    `service: ${order.service}`,
    `serviceId: ${order.serviceId}`,
    `socialPanelId: ${order.socialPanelId}`,
    `quantity: ${order.quantity}`,
    `inputs: ${JSON.stringify(order.inputs || {})}`,
    `stripeSessionId: ${order.stripeSessionId}`,
    `stripePaymentIntentId: ${order.stripePaymentIntentId}`,
    `socialPanelOrderId: ${order.socialPanelOrderId}`,
    `payment status: paid`,
    `fulfilment status: ${order.status}`,
    order.fulfilmentError ? `fulfilment error: ${order.fulfilmentError}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;padding:24px;color:#1f2227;">
    <h1>New paid order ${escapeHtml(order.displayId || order.id)}</h1>
    <pre style="white-space:pre-wrap;font-size:13px;">${escapeHtml(text)}</pre>
  </body></html>`;

  return { subject, text, html };
}

/**
 * @param {unknown} value
 */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

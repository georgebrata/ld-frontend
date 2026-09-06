import { customerEmail, ownerEmail } from './emailTemplates.js';

/**
 * @param {Record<string, string>} env
 * @param {{ to: string, subject: string, html: string, text: string }} message
 */
export async function sendMail(env, message) {
  const response = await fetch('https://api.mailersend.com/v1/email', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.MAILERSEND_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: {
        email: env.FROM_EMAIL,
        name: env.FROM_NAME || 'LikeDealer',
      },
      to: [{ email: message.to }],
      subject: message.subject,
      html: message.html,
      text: message.text,
    }),
  });

  if (!response.ok) {
    throw new Error(`MailerSend HTTP ${response.status}`);
  }
}

/**
 * Send customer + owner mail once. Failures do not change payment status.
 * @param {Record<string, string>} env
 * @param {object} order
 */
export async function sendOrderEmails(env, order) {
  if (order.customerEmailStatus !== 'sent') {
    try {
      const mail = customerEmail(order);
      await sendMail(env, { ...mail, to: order.customerEmail });
      order.customerEmailStatus = 'sent';
    } catch (err) {
      order.customerEmailStatus = 'failed';
      console.error('customer email failed', err instanceof Error ? err.message : 'unknown');
    }
  }

  if (order.ownerEmailStatus !== 'sent' && env.OWNER_EMAIL) {
    try {
      const mail = ownerEmail(order);
      await sendMail(env, { ...mail, to: env.OWNER_EMAIL });
      order.ownerEmailStatus = 'sent';
    } catch (err) {
      order.ownerEmailStatus = 'failed';
      console.error('owner email failed', err instanceof Error ? err.message : 'unknown');
    }
  }

  return order;
}

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { sendOrderEmails } from '../src/email.js';
import { customerEmail } from '../src/emailTemplates.js';

const env = {
  MAILERSEND_API_TOKEN: 'token',
  FROM_EMAIL: 'orders@like-dealer.com',
  FROM_NAME: 'LikeDealer',
  OWNER_EMAIL: 'owner@like-dealer.com',
};

afterEach(() => {
  delete globalThis.fetch;
});

function paidOrder(overrides = {}) {
  return {
    id: 'ord_1',
    displayId: 'LD-ABC123',
    status: 'paid',
    customerEmail: 'a@b.com',
    service: 'Instagram Likes',
    serviceId: '01',
    platform: 'instagram',
    quantity: 1000,
    url: 'https://instagram.com/p/x',
    amountCents: 180,
    customerEmailStatus: 'pending',
    ownerEmailStatus: 'pending',
    ...overrides,
  };
}

test('email failure leaves payment status unchanged', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  const order = paidOrder();
  await sendOrderEmails(env, order);
  assert.equal(order.status, 'paid');
  assert.equal(order.customerEmailStatus, 'failed');
  assert.equal(order.ownerEmailStatus, 'failed');
});

test('MailerSend is not called twice after a successful send', async () => {
  let mails = 0;
  globalThis.fetch = async () => {
    mails += 1;
    return { ok: true, status: 202, json: async () => ({}) };
  };

  const order = paidOrder();
  await sendOrderEmails(env, order);
  await sendOrderEmails(env, order);
  assert.equal(mails, 2);
  assert.equal(order.customerEmailStatus, 'sent');
  assert.equal(order.ownerEmailStatus, 'sent');
});

test('customer email subject uses the display id', () => {
  const mail = customerEmail(paidOrder());
  assert.equal(mail.subject, 'LikeDealer — Order #LD-ABC123 confirmed');
  assert.match(mail.text, /Amount paid: \$1\.80/);
});

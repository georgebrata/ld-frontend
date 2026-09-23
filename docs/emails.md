# Emails

Resend, verified domain. Sender/reply-to from env (`FROM_EMAIL`, `FROM_NAME`, `REPLY_TO_EMAIL`). Templates: `supabase/functions/_shared/email-templates.js` (escape all values). Version `EMAIL_TEMPLATE_VERSION`.

`like-dealer.com` is registered in Resend (`eu-west-1`). Add the DKIM TXT (`resend._domainkey`) and SPF records on the `send` subdomain, then verify. Until that DNS is in place, Edge Functions send from `orders@solon.agency` (already verified). Tracking is off for these transactional receipts.

Customer copy includes order reference, service, quantity, amount/currency, **actual** payment and fulfilment statuses, support contact. No provider secrets or costs.

Owner copy may include internal ids for operations.

## Independence

Payment-confirmation emails are separate jobs (`email_customer_payment`, `email_owner_payment`). Failures never change payment status or block fulfilment. Alerts (`email_owner_alert`) are a third task.

Jobs store subject, template version, idempotency key (`dedupe_key`), attempted timestamp on the **job payload**, send state, and Resend id (`external_ref`). Full HTML is not kept on retry payloads.

Resend idempotency lasts 24 hours. If a send is ambiguous (accepted HTTP unknown), wait out that window or reconcile in the Resend dashboard before sending again. Customer UI uses **accepted** until a signed delivery webhook (`resend-webhook`) sets `delivered` or `bounced`. “Accepted for sending” is not delivery.

## Customize

Edit `email-templates.js` and bump `EMAIL_TEMPLATE_VERSION`. Keep the same `dedupe_key` so already-sent orders are not resent automatically.

#!/usr/bin/env node
/**
 * Pre-flight verification script for Stripe Webhook endpoints.
 * Ensures exactly one enabled webhook endpoint exists for the Supabase stripe-webhook URL.
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_... [SUPABASE_PROJECT_REF=xvrvxofujpqavgnprpmq] node scripts/verify-stripe-webhooks.mjs
 */

const stripeKey = process.env.STRIPE_SECRET_KEY || '';
const projectRef = process.env.SUPABASE_PROJECT_REF || 'xvrvxofujpqavgnprpmq';
const targetSuffix = `/functions/v1/stripe-webhook`;

if (!stripeKey) {
  console.error('Error: STRIPE_SECRET_KEY environment variable is required.');
  process.exit(1);
}

async function verifyWebhooks() {
  console.log(`Checking Stripe webhook endpoints for project [${projectRef}]...`);

  const response = await fetch('https://api.stripe.com/v1/webhook_endpoints?limit=100', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${stripeKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Failed to list webhook endpoints from Stripe API: ${response.status} ${errorText}`);
    process.exit(1);
  }

  const result = await response.json();
  const endpoints = Array.isArray(result?.data) ? result.data : [];

  const matched = endpoints.filter((ep) => {
    const url = String(ep.url || '');
    return url.includes(projectRef) && url.endsWith(targetSuffix);
  });

  const enabled = matched.filter((ep) => ep.status === 'enabled');

  console.log(`Found ${matched.length} total endpoint(s) matching URL pattern (*${targetSuffix}):`);
  for (const ep of matched) {
    console.log(` - ID: ${ep.id} | Status: ${ep.status} | Created: ${new Date(ep.created * 1000).toISOString()} | Description: "${ep.description || ''}"`);
  }

  if (enabled.length === 0) {
    console.error(`\n❌ ERROR: No enabled webhook endpoints found matching ${targetSuffix}. Payments will not be processed!`);
    process.exit(1);
  }

  if (enabled.length > 1) {
    console.error(`\n❌ ERROR: Detected ${enabled.length} duplicate ENABLED webhook endpoints!`);
    console.error('Having multiple enabled webhooks will double-deliver events and cause signature verification failures.');
    process.exit(1);
  }

  console.log(`\n✅ OK: Exactly one enabled webhook endpoint (${enabled[0].id}) is configured.`);
}

verifyWebhooks().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateOperatorCommand } from '../supabase/functions/_shared/operator.js';

test('operator command schema file lists the implemented commands', () => {
  const schema = JSON.parse(readFileSync(new URL('../contracts/operator-commands.schema.json', import.meta.url)));
  for (const command of schema.properties.command.enum) {
    const result = validateOperatorCommand({
      command,
      reason: 'schema coverage',
      idempotencyKey: `schema-${command}`,
      orderId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      jobId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      providerOrderId: '1',
      amountMinor: 100,
      enabled: false,
    });
    assert.equal(result.ok, true, command);
  }
});

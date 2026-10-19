import { randomUUID } from 'node:crypto';

import { DeveloperKey, Hevn, IntentRefused, type Hex } from '../src/index.ts';

const [clientId, contactId, amount, address] = process.argv.slice(2);
if (!clientId || !contactId || !amount) {
  console.error('usage: node examples/payout.ts <cl_…> <ct_…> <amount> [0xrecipient]');
  process.exit(1);
}

const hevn = Hevn.connect({ key: DeveloperKey.fromEnv(), email: process.env.HEVN_EMAIL ?? '' });
const client = hevn.actingAs(clientId);

try {
  const { prepared, receipt } = await client.payouts.send(
    { contactId, amount },
    {
      debit: { token: 'USDC', amount, address: address as Hex | undefined },
      intent: 'client',
      quote: { fromAmount: amount },
    },
    { idempotencyKey: `example-payout-${randomUUID()}` },
  );
  console.log('payout', prepared.id, receipt.status, receipt.transactionHash ?? '');
} catch (error) {
  if (error instanceof IntentRefused) {
    console.error('refused to sign:', error.code, error.message, error.details);
    process.exit(2);
  }
  throw error;
}

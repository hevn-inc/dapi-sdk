import { randomUUID } from 'node:crypto';

import { DeveloperKey, Hevn, HevnApiError } from '../src/index.ts';

const [clientId, from = 'USDC', to = 'EURC', amount = '0.20'] = process.argv.slice(2);
if (!clientId) {
  console.error('usage: node examples/swap.ts <cl_…> [from] [to] [amount]');
  process.exit(1);
}

const hevn = Hevn.connect({ key: DeveloperKey.fromEnv(), email: process.env.HEVN_EMAIL ?? '' });
const client = hevn.actingAs(clientId);

try {
  // Preview reserves nothing; it is safe to call on every keystroke.
  const priced = await client.swaps.preview<{ quote: { toAmount: string; rate: string; feeAmount: string } }>({
    sourceAccount: from,
    destinationAccount: to,
    amount,
  });
  console.log('swap quote', `${amount} ${from} -> ${priced.quote.toAmount} ${to}`, 'rate', priced.quote.rate, 'fee', priced.quote.feeAmount);

  const { prepared, receipt } = await client.swaps.send(
    { sourceAccount: from, destinationAccount: to, amount },
    { debit: { token: from, amount }, intent: 'client' },
    { idempotencyKey: `swap-${randomUUID()}` },
  );
  console.log('swap', prepared.id, receipt.status, receipt.transactionHash ?? '');
} catch (error) {
  // The sandbox has no exchange venue behind it, so swaps are refused there.
  if (!(error instanceof HevnApiError)) throw error;
  console.error('swap refused:', error.status, error.code, error.message);
  process.exit(2);
}

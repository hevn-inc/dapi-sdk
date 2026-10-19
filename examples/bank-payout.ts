import { randomUUID } from 'node:crypto';

import { DeveloperKey, Hevn, HevnApiError, pollUntil } from '../src/index.ts';

const [clientId, amount = '0.20', outcome = 'settled'] = process.argv.slice(2);
if (!clientId || !['settled', 'refunded', 'failed'].includes(outcome)) {
  console.error('usage: node examples/bank-payout.ts <cl_…> [amount] [settled|refunded|failed]');
  process.exit(1);
}

interface Capabilities {
  available: boolean;
  options: { bankId: string; method: string; currency: string; minAmount: string; feeBps: number; fixedFee: string; blockers: { code: string }[] }[];
}

const hevn = Hevn.connect({ key: DeveloperKey.fromEnv(), email: process.env.HEVN_EMAIL ?? '' });
const client = hevn.actingAs(clientId);

// A bank contact carries the beneficiary's account details and a complete postal address. The same details give the same contact.
const contact = await client.contacts.create<{ id: string }>({
  name: 'Ardenne Fabrication SARL',
  bank: {
    method: 'sepa',
    currency: 'EUR',
    fields: { iban: 'FR7630006000011234567890189' },
    holder: { type: 'business', businessName: 'Ardenne Fabrication SARL' },
    bankName: 'BNP Paribas',
  },
  address: { country: 'FR', city: 'Lyon', streetAddress: '12 Rue Garibaldi', zip: '69006' },
});

// What paying this contact would cost, and anything that would refuse it.
const capabilities = await client.get<Capabilities>(`/contacts/${contact.id}/capabilities`, { amount });
for (const option of capabilities.options) {
  console.log(
    'option',
    option.method,
    option.currency,
    'min',
    option.minAmount,
    'fee',
    `${option.feeBps}bps+${option.fixedFee}`,
    option.blockers.map((b) => b.code).join(',') || 'ok',
  );
}
if (!capabilities.available) process.exit(2);

// One call quotes and books the payout; the SDK checks the debit it echoes before signing.
const { prepared, receipt } = await client.payouts.send(
  { contactId: contact.id, amount, paymentReference: 'INV-2026-114' },
  { debit: { token: 'USDC', amount }, intent: 'client' },
  { idempotencyKey: `bank-payout-${randomUUID()}` },
);
console.log('payout', prepared.id, receipt.status, receipt.transactionHash ?? '');

// The sandbox partner settles nothing on its own: move the payout as the bank would. Until the signed debit is
// seen on chain the move answers payout_not_fundable, and a refund answers 202 until the money is back; both just repeat.
const move = async () => {
  try {
    return await client.sandbox.payoutStatus<{ refundTxHash?: string }>(prepared.id, { status: outcome });
  } catch (error) {
    if (error instanceof HevnApiError && error.code === 'payout_not_fundable') return null;
    throw error;
  }
};
if (hevn.environment.name === 'sandbox') {
  await pollUntil(move, (moved) => moved !== null && (outcome !== 'refunded' || Boolean(moved.refundTxHash)), { deadlineMs: 180_000 });
}
const payout = await client.payouts.get<{ status: string; quote?: { toAmount: string; toCurrency: string } }>(prepared.id);
console.log('payout status', payout.status, payout.quote?.toAmount ?? '', payout.quote?.toCurrency ?? '');

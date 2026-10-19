import { randomUUID } from 'node:crypto';

import { DeveloperKey, Hevn } from '../src/index.ts';

const [clientId, amount = '0.30', currency = 'EUR', method = 'sepa'] = process.argv.slice(2);
if (!clientId) {
  console.error('usage: node examples/sandbox-wire.ts <cl_…> [amount] [currency] [method]');
  process.exit(1);
}

const hevn = Hevn.connect({ key: DeveloperKey.fromEnv(), email: process.env.HEVN_EMAIL ?? '' });
const client = hevn.actingAs(clientId);

// An open rail's account details stay live: anyone can wire to them without a quote.
const { rails } = await client.banks.list<{ rails: { currency: string; method: string; status?: string; id?: string }[] }>();
const bank = rails.find((r) => r.currency === currency && r.method === method && r.status === 'active');
if (!bank?.id) throw new Error(`${clientId} has no active ${currency} ${method} rail; run open-rail.ts first`);

// The sandbox plays the payer's bank: an unsolicited transfer into those account details.
const reference = `INV-${randomUUID().slice(0, 8)}`;
const credit = await client.sandbox.deposit<{ status: string; credited: string; token: string; transactionId: string }>(
  { bankId: bank.id, amount, remitter: 'ACME GmbH', paymentReference: reference },
  { idempotencyKey: `wire-${reference}` },
);
console.log('wire', reference, credit.status, credit.credited, credit.token, credit.transactionId);

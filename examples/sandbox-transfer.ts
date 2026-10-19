import { randomUUID } from 'node:crypto';

import { DeveloperKey, Hevn, pollUntil, type Hex } from '../src/index.ts';

const [fromId, toId, amount = '0.10'] = process.argv.slice(2);
if (!fromId || !toId) {
  console.error('usage: node examples/sandbox-transfer.ts <cl_from> <cl_to> [amount]');
  process.exit(1);
}

const runId = randomUUID().slice(0, 8);
const hevn = Hevn.connect({ key: DeveloperKey.fromEnv(), email: process.env.HEVN_EMAIL ?? '' });
const from = hevn.actingAs(fromId);
const to = await hevn.actingAs(toId).clients.current();

// The sandbox credits test USDC straight to the client's wallet.
const credit = await pollUntil(
  () => from.sandbox.deposit<{ status: string }>({ amount, token: 'USDC' }, { idempotencyKey: `example-${runId}-payin` }),
  (seen) => seen.status !== 'submitted',
  { deadlineMs: 180_000 },
);
console.log('sandbox credit', credit.status);

const contact = await from.contacts.create<{ id: string }>({ name: `Example ${toId}`, account: { accountType: 'email', email: to.email } });
const { prepared, receipt } = await from.payouts.send(
  { contactId: contact.id, amount },
  { debit: { token: 'USDC', amount, address: to.baseSmartWallet as Hex }, intent: 'client' },
  { idempotencyKey: `example-${runId}-transfer` },
);
console.log('payout', prepared.id, receipt.status, receipt.transactionHash ?? '');

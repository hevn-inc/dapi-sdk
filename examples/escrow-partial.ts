import { DeveloperKey, Hevn, type ClientId } from '../src/index.ts';

const [buyer, seller, held, shipped] = process.argv.slice(2);
if (!buyer || !seller || !held || !shipped) {
  console.error('usage: node examples/escrow-partial.ts <cl_buyer> <cl_seller> <held> <shipped>');
  process.exit(1);
}

const hevn = Hevn.connect({ key: DeveloperKey.fromEnv(), email: process.env.HEVN_EMAIL ?? '' });

// Only part of the order shipped: capture the shipped lines, then void the rest back to the buyer.
const opened = await hevn.escrow.open({
  senderClientId: buyer as ClientId,
  receiverClientId: seller as ClientId,
  token: 'USDC',
  maxAmount: held,
  holdFor: '1d',
});
console.log('escrow', opened.deal.id, opened.deal.status);

const authorized = await hevn.escrow.run(opened.deal.id, { action: 'authorize', amount: held });
console.log('authorize', authorized.action.status, authorized.deal.capturableAmount);

const captured = await hevn.escrow.run(opened.deal.id, { action: 'capture', amount: shipped, feeBps: 0 });
console.log('capture', captured.action.status, captured.deal.status, captured.deal.capturableAmount);

// Branch on what the server says is legal now, not on status.
if (!captured.deal.availableActions.includes('void')) throw new Error(`void is not available: ${captured.deal.availableActions.join(',')}`);
const voided = await hevn.escrow.run(opened.deal.id, { action: 'void' });
console.log('void', voided.action.status, voided.deal.status);

import { DeveloperKey, Hevn, type ClientId } from '../src/index.ts';

const [buyer, seller, amount] = process.argv.slice(2);
if (!buyer || !seller || !amount) {
  console.error('usage: node examples/escrow-refund.ts <cl_buyer> <cl_seller> <amount>');
  process.exit(1);
}

const hevn = Hevn.connect({ key: DeveloperKey.fromEnv(), email: process.env.HEVN_EMAIL ?? '' });

// Nothing to wait for: charge pays the seller in one on-chain action, with no hold in between.
const opened = await hevn.escrow.open({
  senderClientId: buyer as ClientId,
  receiverClientId: seller as ClientId,
  token: 'USDC',
  maxAmount: amount,
  refundableFor: '30d',
});
const charged = await hevn.escrow.run(opened.deal.id, { action: 'charge', amount, feeBps: 0 });
console.log('charge', opened.deal.id, charged.action.status, charged.deal.status);

// The goods came back. A refund is paid out of your own wallet, not the seller's, so keep a balance in the deal's token.
const refunded = await hevn.escrow.run(opened.deal.id, { action: 'refund', amount });
console.log('refund', refunded.action.status, refunded.deal.status, refunded.action.transactionHash ?? '');

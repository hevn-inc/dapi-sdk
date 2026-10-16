import { DeveloperKey, Hevn, type ClientId } from '../src/index.ts';

const [sender, receiver, maxAmount] = process.argv.slice(2);
if (!sender || !receiver || !maxAmount) {
  console.error('usage: node examples/escrow.ts <cl_sender> <cl_receiver> <maxAmount>');
  process.exit(1);
}

const hevn = Hevn.connect({ key: DeveloperKey.fromEnv(), email: process.env.HEVN_EMAIL ?? '' });

const opened = await hevn.escrow.open({
  senderClientId: sender as ClientId,
  receiverClientId: receiver as ClientId,
  token: 'USDC',
  maxAmount,
  holdFor: '1d',
});
console.log('escrow', opened.deal.id, opened.deal.status, opened.action.status);

const authorized = await hevn.escrow.run(opened.deal.id, { action: 'authorize', amount: maxAmount });
console.log('authorize', authorized.action.status, authorized.action.transactionHash ?? '');

const captured = await hevn.escrow.run(opened.deal.id, { action: 'capture', amount: maxAmount, feeBps: 0 });
console.log('capture', captured.action.status, captured.deal.status);

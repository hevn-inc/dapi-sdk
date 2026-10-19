import { DeveloperKey, Hevn, pollUntil } from '../src/index.ts';

const [clientId, amount = '0.50', currency = 'EUR', method = 'sepa'] = process.argv.slice(2);
if (!clientId) {
  console.error('usage: node examples/payin.ts <cl_…> [amount] [currency] [method]');
  process.exit(1);
}

interface Payin {
  id: string;
  status: string;
  quote: { amount: string; currency: string; settlementAmount: string; destinationAccount: string; feeAmount: string; rate: string };
}

const hevn = Hevn.connect({ key: DeveloperKey.fromEnv(), email: process.env.HEVN_EMAIL ?? '' });
const client = hevn.actingAs(clientId);

// Price the deposit first: the rate and fee hold until the quote expires.
const payin = await client.payins.create<Payin>({ amount, currency, rail: method, destinationAccount: 'USDC' });
const { quote } = payin;
console.log(
  'quote',
  payin.id,
  `${quote.amount} ${quote.currency} -> ${quote.settlementAmount} ${quote.destinationAccount}`,
  'fee',
  quote.feeAmount,
  'rate',
  quote.rate,
);

// Hand these to the payer verbatim, paymentReference included.
const instructions = await client.payins.instructions<{ kind: string; paymentReference?: string; requisites?: { fields: Record<string, string> } }>(payin.id);
console.log('instructions', instructions.kind, instructions.paymentReference ?? '-', JSON.stringify(instructions.requisites?.fields ?? {}));

// The sandbox has no payer: this call is the payer's bank transfer arriving.
if (hevn.environment.name === 'sandbox') await client.sandbox.completePayin(payin.id, { remitter: 'Payer GmbH' });

const settled = await pollUntil(
  () => client.payins.get<Payin>(payin.id),
  (seen) => !['pending', 'awaitingFunds'].includes(seen.status),
);
console.log('payin', settled.id, settled.status, settled.quote.settlementAmount);

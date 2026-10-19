import { DeveloperKey, Hevn, HevnApiError } from '../src/index.ts';

const [clientId, amount = '0.10'] = process.argv.slice(2);
if (!clientId) {
  console.error('usage: node examples/arb-account.ts <cl_…> [amount]');
  process.exit(1);
}

interface Balance {
  baseSmartWallet: string | null;
  accounts: { account: string; balance: string; usdValue: string }[];
}
interface Chains {
  chains: { chain: string; chainId: number | null; settlement: boolean; tokens: { symbol: string; address: string | null; account?: string }[] }[];
}

const hevn = Hevn.connect({ key: DeveloperKey.fromEnv(), email: process.env.HEVN_EMAIL ?? '' });
const client = hevn.actingAs(clientId);

// USDC_ARB is on by default: the first balance read turns it on, at the client's own wallet address.
const balance = await client.clients.balance<Balance>();
const held = balance.accounts.find((row) => row.account === 'USDC_ARB');
if (!held) {
  console.error('no USDC_ARB account on', clientId, balance.accounts.map((row) => row.account).join(','));
  process.exit(2);
}
console.log('account USDC_ARB', held.balance, held.usdValue);

// The catalog names the chain and contract to send to; the wallet address is the same as on Base.
const { chains } = await hevn.get<Chains>('/chains');
const arb = chains.find((chain) => chain.tokens.some((token) => token.account === 'USDC_ARB'));
const usdc = arb?.tokens.find((token) => token.account === 'USDC_ARB');
if (!arb || !usdc) throw new Error('the catalog names no chain for USDC_ARB');
console.log('deposit USDC on', arb.chain, arb.chainId, 'token', usdc.address, 'to', balance.baseSmartWallet, 'settlement', arb.settlement);

// Arbitrum rows in the ledger name the account they moved.
const { items } = await client.transactions.list<{ id: string; account?: string; isIncome: boolean; to?: { amount: string } }>({ limit: 50 });
const arbRows = items.filter((row) => row.account === 'USDC_ARB');
console.log('ledger USDC_ARB rows', arbRows.length);

// The account holds and receives only: moving money out of it is refused until spending from Arbitrum lands.
try {
  await client.swaps.preview({ sourceAccount: 'USDC_ARB', destinationAccount: 'USDC', amount });
  console.log('swap from USDC_ARB accepted');
} catch (error) {
  if (!(error instanceof HevnApiError)) throw error;
  console.log('swap from USDC_ARB refused', error.status, error.code);
}

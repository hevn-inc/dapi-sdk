import { DeveloperKey, Hevn, pollUntil } from '../src/index.ts';

const [clientId, currency = 'EUR', method = 'sepa', token = 'USDC'] = process.argv.slice(2);
if (!clientId) {
  console.error('usage: node examples/open-rail.ts <cl_…> [currency] [method] [token]');
  process.exit(1);
}

interface Rail {
  rail: string;
  currency: string;
  method: string;
  status?: string;
  id?: string;
  supportedAccounts: string[];
  requisites?: { fields: Record<string, string>; holder: { businessName?: string }; bankName?: string };
}

const hevn = Hevn.connect({ key: DeveloperKey.fromEnv(), email: process.env.HEVN_EMAIL ?? '' });
const client = hevn.actingAs(clientId);

// Rail ids differ per environment: pick by what the rail does, in the client's own name ("named"), settling in `token`.
const { rails } = await client.banks.list<{ rails: Rail[] }>();
const { rail } = rails.find((r) => r.currency === currency && r.method === method && r.rail.includes('_named') && r.supportedAccounts.includes(token)) ?? {};
if (!rail) throw new Error(`no ${currency} ${method} rail for ${clientId}`);

const needs = await client.banks.requirements<{ available: boolean; blockers: { code: string; message: string }[] }>(rail);
if (!needs.available) {
  console.error('rail blocked:', needs.blockers.map((b) => b.code).join(', '));
  process.exit(2);
}

await client.banks.open({ rail });
// In production review takes hours to days; the sandbox activates the rail at once.
const opened = await pollUntil(
  () => client.banks.get<Rail>(rail),
  (r) => r.status !== 'preparing',
);
console.log('rail', opened.rail, opened.status, opened.id);
console.log('pay to', opened.requisites?.holder.businessName, JSON.stringify(opened.requisites?.fields), opened.requisites?.bankName);

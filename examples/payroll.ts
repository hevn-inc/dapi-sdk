import { DeveloperKey, Hevn } from '../src/index.ts';

const [clientId, runId, amount = '0.10'] = process.argv.slice(2);
if (!clientId || !runId) {
  console.error('usage: node examples/payroll.ts <cl_employer> <run-id> [amount per contractor]');
  process.exit(1);
}

const contractors = [
  {
    key: 'contractor-441',
    name: 'Lena Fischer',
    iban: 'DE89370400440532013000',
    bankName: 'Commerzbank',
    address: { country: 'DE', city: 'Berlin', streetAddress: 'Torstrasse 101', zip: '10119' },
  },
  {
    key: 'contractor-442',
    name: 'Daan de Vries',
    iban: 'NL91ABNA0417164300',
    bankName: 'ABN AMRO',
    address: { country: 'NL', city: 'Amsterdam', streetAddress: 'Keizersgracht 62', zip: '1015CS' },
  },
];

const hevn = Hevn.connect({ key: DeveloperKey.fromEnv(), email: process.env.HEVN_EMAIL ?? '' });
const employer = hevn.actingAs(clientId);

for (const contractor of contractors) {
  const contact = await employer.contacts.create<{ id: string }>({
    name: contractor.name,
    bank: {
      method: 'sepa',
      currency: 'EUR',
      fields: { iban: contractor.iban },
      holder: { type: 'individual', firstName: contractor.name.split(' ')[0], lastName: contractor.name.split(' ').slice(1).join(' ') },
      bankName: contractor.bankName,
    },
    address: contractor.address,
  });
  // The key names the payment: re-running the same run after a crash replays it instead of paying twice.
  const { prepared, receipt } = await employer.payouts.send(
    { contactId: contact.id, amount, paymentReference: `${runId} ${contractor.key}` },
    { debit: { token: 'USDC', amount }, intent: 'client' },
    { idempotencyKey: `${runId}:${contractor.key}` },
  );
  console.log('paid', contractor.key, prepared.id, receipt.status);
}

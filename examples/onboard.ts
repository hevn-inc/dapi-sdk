import { readFileSync } from 'node:fs';

import { DeveloperKey, Hevn, pollUntil } from '../src/index.ts';

const [clientId, phone = '+13125550142', papers = 'examples/papers/sample.pdf'] = process.argv.slice(2);
if (!clientId) {
  console.error('usage: node examples/onboard.ts <cl_…> [phone] [paper.pdf]');
  process.exit(1);
}

const hevn = Hevn.connect({ key: DeveloperKey.fromEnv(), email: process.env.HEVN_EMAIL ?? '' });
const client = hevn.actingAs(clientId);
const { name } = await client.clients.current<{ name: string }>();

// Every bank rail checks the account phone, not the one inside the KYB document.
await client.clients.update({ phone });

// One PDF stands in for every paper here; send the real certificate, register extract and so on.
const content = readFileSync(papers).toString('base64');
const upload = async (slot: string) => {
  const { id } = await client.documents.upload<{ id: string }>({ slot, fileName: `${slot}.pdf`, content });
  return { slot, uploadId: id };
};
const companyPapers = [
  'certificate_of_incorporation',
  'corporate_structure',
  'director_structure',
  'proof_of_address',
  'source_of_funds',
  'tax_identification_document',
];

const readiness = await client.clients.submitKyb<{ ready: boolean; missing: string[] }>({
  company: {
    legalName: name,
    country: 'US',
    taxId: '88-1234567',
    phone,
    address: { streetAddress: '401 N Michigan Ave', city: 'Chicago', state: 'US-IL', zip: '60601', country: 'US' },
    entityType: 'llc',
    expectedMonthlyVolumeUsd: '250000',
    businessDescription: 'Wholesale and retail distribution of industrial fasteners.',
    businessType: 'retail',
    sourceOfFunds: 'business_revenue',
    purposeOfFunds: 'vendor_payments',
    flowOfFunds: 'Customers pay us by wire; we pay suppliers in EUR.',
  },
  people: [
    {
      key: 'jane',
      firstName: 'Jane',
      lastName: 'Doe',
      dateOfBirth: '1984-02-11',
      phone: '+13125550188',
      address: { streetAddress: '1120 W Fulton Market', city: 'Chicago', state: 'US-IL', zip: '60607', country: 'US' },
      taxIdCountry: 'US',
      taxId: '123-45-6789',
      ownershipPercentage: '100',
      hasControl: true,
      isDirector: true,
      isSigner: true,
      documents: [await upload('proof_of_address')],
    },
  ],
  documents: await Promise.all(companyPapers.map(upload)),
});
console.log('kyb document ready', readiness.ready, readiness.missing.join(',') || '-');
if (!readiness.ready) process.exit(2);

const application = await client.clients.completeKyb<{ applicationId: string; status: string }>();
console.log('kyb application', application.applicationId, application.status);

// In production a HEVN reviewer decides, in minutes to days; in the sandbox you play the reviewer.
if (hevn.environment.name === 'sandbox' && application.status === 'pending') await client.sandbox.kybStatus({ status: 'approved' });

// There is no webhook: poll until the review is decided.
const kyb = await pollUntil(
  () => client.clients.kyb<{ status: string; application?: { comment?: string } }>(),
  (seen) => seen.status !== 'pending',
);
console.log('kyb status', kyb.status, kyb.application?.comment ?? '');

import { readFileSync } from 'node:fs';

import { DeveloperKey, Hevn, pollUntil } from '../src/index.ts';

const [clientId, papers = 'examples/papers/sample.pdf'] = process.argv.slice(2);
if (!clientId) {
  console.error('usage: node examples/kyb-rfi.ts <cl_…> [paper.pdf]   # after onboard.ts');
  process.exit(1);
}

interface Kyb {
  status: string;
  application?: { id: string; attemptNo: number; comment?: string };
  document: { company: { legalName: string }; people: ({ key?: string } & Record<string, unknown>)[]; documents: { slot: string; uploadId: string }[] };
}

const hevn = Hevn.connect({ key: DeveloperKey.fromEnv(), email: process.env.HEVN_EMAIL ?? '' });
const client = hevn.actingAs(clientId);
const decided = () =>
  pollUntil(
    () => client.clients.kyb<Kyb>(),
    (seen) => seen.status !== 'pending',
  );

// The sandbox reviewer sends the application back, as a real one would: one stale paper, one unreadable value.
if (hevn.environment.name === 'sandbox') {
  await client.sandbox.kybStatus({
    status: 'rfi',
    comment: 'The proof of address for Jane Doe is older than three months, and the registration number on the certificate of incorporation is unreadable.',
  });
}
const rfi = await decided();
console.log('kyb rfi', rfi.status, rfi.application?.attemptNo, rfi.application?.comment ?? '');
if (rfi.status !== 'rfi') process.exit(2);

// Answer it with a normal write: a new upload in an occupied slot replaces what was there.
const fresh = Buffer.concat([readFileSync(papers), Buffer.from(`\n% re-issued ${new Date().toISOString()}\n`)]);
const { id: uploadId } = await client.documents.upload<{ id: string }>({
  slot: 'proof_of_address',
  fileName: 'jane-proof-of-address.pdf',
  content: fresh.toString('base64'),
});
// `people` replaces the roster, so write back the people HEVN holds with only Jane's paper changed.
const people = rfi.document.people.map((person) => (person.key === 'jane' ? { ...person, documents: [{ slot: 'proof_of_address', uploadId }] } : person));
await client.clients.submitKyb({ people });

// A value the reviewer cannot read off a paper is written onto that upload by hand. These keys are snake_case.
const certificate = rfi.document.documents.find((paper) => paper.slot === 'certificate_of_incorporation');
if (!certificate) throw new Error('no certificate of incorporation on file; run onboard.ts first');
await client.documents.content(certificate.uploadId, {
  fields: { entity_name: rfi.document.company.legalName, registration_number: '7712043', jurisdiction: 'US', incorporation_date: '2019-04-02' },
});
console.log('kyb answered', 'proof_of_address', uploadId, 'certificate_of_incorporation', certificate.uploadId);

// Completing again files the next attempt.
const again = await client.clients.completeKyb<{ applicationId: string; status: string; attemptNo: number }>();
console.log('kyb resubmitted', again.applicationId, again.status, again.attemptNo);

if (hevn.environment.name === 'sandbox') await client.sandbox.kybStatus({ status: 'approved' });
const approved = await decided();
console.log('kyb status', approved.status, approved.application?.attemptNo);

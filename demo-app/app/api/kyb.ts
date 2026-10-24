import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { pollUntil, type Hevn } from '@hevn/dapi-sdk';

interface Kyb {
  status: string;
  ready?: boolean;
}

/** Sandbox only: files KYB for a sample company and approves it as the reviewer would. */
export class SandboxKyb {
  private static readonly PAPER = resolve(process.cwd(), '..', 'examples/papers/sample.pdf');
  private static readonly PHONE = '+13125550142';
  private static readonly SLOTS = [
    'certificate_of_incorporation',
    'corporate_structure',
    'director_structure',
    'proof_of_address',
    'source_of_funds',
    'tax_identification_document',
  ];

  constructor(private readonly client: Hevn) {}

  async pass(): Promise<Kyb> {
    const before = await this.client.clients.kyb<Kyb>();
    if (before.status === 'approved') return before;
    if (before.status !== 'pending') {
      const readiness = await this.submit();
      if (!readiness.ready) return readiness;
      await this.client.clients.completeKyb();
    }
    await this.client.sandbox.kybStatus({ status: 'approved' });
    return pollUntil(
      () => this.client.clients.kyb<Kyb>(),
      (kyb) => kyb.status !== 'pending',
      { deadlineMs: 30_000 },
    );
  }

  private async submit(): Promise<Kyb> {
    const content = (await readFile(SandboxKyb.PAPER)).toString('base64');
    const upload = async (slot: string) => {
      const { id } = await this.client.documents.upload<{ id: string }>({ slot, fileName: `${slot}.pdf`, content });
      return { slot, uploadId: id };
    };
    await this.client.clients.update({ phone: SandboxKyb.PHONE });
    return this.client.clients.submitKyb<Kyb>({
      company: {
        legalName: 'Acme Fasteners LLC',
        country: 'US',
        taxId: '88-1234567',
        phone: SandboxKyb.PHONE,
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
      documents: await Promise.all(SandboxKyb.SLOTS.map(upload)),
    });
  }
}

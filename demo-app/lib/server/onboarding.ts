import { readFile } from 'node:fs/promises';

import { pollUntil, type Hevn } from '@hevn/dapi-sdk';

import { Config } from './config';

interface Kyb {
  status: string;
  missing?: string[];
}

interface Readiness {
  ready: boolean;
  missing: string[];
}

export class Onboarding {
  static readonly PHONE = '+13125550142';
  static readonly PAPERS = [
    'certificate_of_incorporation',
    'corporate_structure',
    'director_structure',
    'proof_of_address',
    'source_of_funds',
    'tax_identification_document',
  ];

  static paper: Promise<string> | null = null;

  readonly client: Hevn;
  readonly content: string;

  constructor(client: Hevn, content: string) {
    this.client = client;
    this.content = content;
  }

  static async for(client: Hevn): Promise<Onboarding> {
    Onboarding.paper ??= readFile(Config.paper).then((bytes) => bytes.toString('base64'));
    return new Onboarding(client, await Onboarding.paper);
  }

  async upload(slot: string): Promise<{ slot: string; uploadId: string }> {
    const { id } = await this.client.documents.upload<{ id: string }>({ slot, fileName: `${slot}.pdf`, content: this.content });
    return { slot, uploadId: id };
  }

  async fill(): Promise<Readiness> {
    const current = await this.client.clients.current<{ id: string; email?: string | null; name?: string }>();
    await this.client.clients.update({ phone: Onboarding.PHONE });
    const handle = (current.email ?? current.id).split('@')[0];
    const legalName = current.name || `Mini HEVN ${handle} LLC`;
    return this.client.clients.submitKyb<Readiness>({
      company: {
        legalName,
        country: 'US',
        taxId: '88-1234567',
        phone: Onboarding.PHONE,
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
          documents: [await this.upload('proof_of_address')],
        },
      ],
      documents: await Promise.all(Onboarding.PAPERS.map((slot) => this.upload(slot))),
    });
  }

  async run(): Promise<Kyb | Readiness> {
    const before = await this.client.clients.kyb<Kyb>();
    if (before.status === 'approved') return before;
    if (before.status !== 'pending') {
      const readiness = await this.fill();
      if (!readiness.ready) return readiness;
      await this.client.clients.completeKyb();
    }
    await this.client.sandbox.kybStatus({ status: 'approved' });
    return pollUntil(
      () => this.client.clients.kyb<Kyb>(),
      (seen) => seen.status !== 'pending',
      { deadlineMs: 30_000 },
    );
  }
}

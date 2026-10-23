import { DeveloperKey, Hevn } from '@hevn/dapi-sdk';

import { Config } from './config';
import { Journal } from './journal';

const shared = globalThis as typeof globalThis & { __neobankHevn?: Hevn };

export class Partner {
  static get hevn(): Hevn {
    if (shared.__neobankHevn) return shared.__neobankHevn;
    Config.load();
    shared.__neobankHevn = Hevn.connect({ key: DeveloperKey.fromEnv(), email: process.env.HEVN_EMAIL ?? '', fetch: Journal.fetch });
    return shared.__neobankHevn;
  }

  static as(clientId: string): Hevn {
    return Partner.hevn.actingAs(clientId);
  }
}

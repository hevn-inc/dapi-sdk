import { randomUUID } from 'node:crypto';

import { Api, Refusal } from '@/lib/server/api';
import { Config } from '@/lib/server/config';
import { Partner } from '@/lib/server/hevn';

export const POST = Api.authed(async ({ client, request }) => {
  const body = await Api.body(request);
  const address = Api.text(body, 'address');
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Refusal(400, 'invalid_address', 'Enter a Base wallet address: 0x followed by 40 hex characters.');
  const amount = Api.amount(Api.text(body, 'amount'));
  const contact = await client.contacts.create<{ id: string }>({
    name: `Wallet ${address.slice(0, 6)}…${address.slice(-4)}`,
    crypto: { chain: 'base', token: 'USDC', address },
  });
  const payout = await client.payouts.create({ contactId: contact.id, amount }, { idempotencyKey: `neobank-payout-${randomUUID()}` });
  const signing = await Partner.hevn.connect.sessions.create({ action: 'sign', payoutId: payout.id, redirectUri: Config.redirectUri });
  return { payout, url: signing.url };
});

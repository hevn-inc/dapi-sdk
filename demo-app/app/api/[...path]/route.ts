import { randomUUID } from 'node:crypto';

import type { Client } from '@hevn/dapi-sdk';

import { config } from '../config';
import { pendingLink, session } from '../cookies';
import { SandboxKyb } from '../kyb';
import { Refusal, Router } from '../router';

export const maxDuration = 60;

const router = new Router()
  // Sign in with HEVN: start a link session, then trade the code the popup returns for the client it belongs to.
  .post('auth/session', async (exchange) => {
    const link = await exchange.partner.connect.sessions.create({ action: 'link', redirectUri: config.redirectUri });
    exchange.set(pendingLink, { state: link.state });
    return { url: link.url };
  })
  .post('auth/link', async (exchange) => {
    const started = exchange.read(pendingLink);
    exchange.set(pendingLink, null);
    if (!started || started.state !== exchange.body.state) throw new Refusal(400, 'state_mismatch', 'This sign-in was not started in this browser.');
    const client = await exchange.partner.clients.link<Client>(exchange.body.code);
    exchange.set(session, { clientId: client.id });
    return { signedIn: true };
  })
  .post('auth/logout', async (exchange) => {
    exchange.set(session, null);
    return { signedIn: false };
  })

  .get('me', async ({ client }) => ({ ...(await client.clients.current<Client>()), environment: client.environment.name }))
  .get('balance', ({ client }) => client.clients.balance())
  .get('transactions', ({ client }) => client.transactions.list({ limit: 15 }))
  .post('deposit', ({ client, body }) => client.sandbox.deposit({ amount: body.amount, token: 'USDC' }, { idempotencyKey: randomUUID() }))

  .get('kyb', ({ client }) => client.clients.kyb())
  .post('kyb/run', ({ client }) => new SandboxKyb(client).pass())

  .get('banks', ({ client }) => client.banks.list())
  .get('banks/:rail', ({ client, params }) => client.banks.get(params.rail))
  .get('banks/:rail/requirements', ({ client, params }) => client.banks.requirements(params.rail))
  .post('banks/:rail', async ({ client, params }) => {
    await client.banks.open({ rail: params.rail }, { idempotencyKey: randomUUID() });
    return client.banks.get(params.rail);
  })

  // A payout to a wallet: save the address as a contact, create the payout, and hand back a session the visitor signs in HEVN.
  .post('payouts', async ({ client, partner, body }) => {
    const contact = await client.contacts.create<{ id: string }>({
      name: `Wallet ${body.address.slice(0, 6)}…${body.address.slice(-4)}`,
      crypto: { chain: 'base', token: 'USDC', address: body.address },
    });
    const payout = await client.payouts.create({ contactId: contact.id, amount: body.amount }, { idempotencyKey: randomUUID() });
    const signing = await partner.connect.sessions.create({ action: 'sign', payoutId: payout.id, redirectUri: config.redirectUri });
    return { payout, url: signing.url };
  })
  .get('payouts/:id', ({ client, params }) => client.payouts.get(params.id));

export const GET = router.handle;
export const POST = router.handle;

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DeveloperKey, Hevn, HevnApiError, IntentRefused, PublicKeys, type Fetch } from '../src/index.ts';

import { NOW, RECIPIENT, SANDBOX, approval, debitPayout, payload } from './fixtures.ts';

interface Call {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
}

type Handler = (call: Call) => { status: number; body?: unknown; headers?: Record<string, string> };

function fakeApi(handlers: Record<string, Handler | Handler[]>) {
  const calls: Call[] = [];
  const fetchImpl: Fetch = async (input, init) => {
    const url = new URL(String(input));
    const call: Call = {
      method: init?.method ?? 'GET',
      path: url.pathname.replace('/dapi/v1', '') + url.search,
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    };
    calls.push(call);
    const route = `${call.method} ${call.path}`;
    const handler = handlers[route];
    const next = Array.isArray(handler) ? handler.shift() : handler;
    if (!next) throw new Error(`unexpected ${route}`);
    const answer = next(call);
    return new Response(answer.body === undefined ? '' : JSON.stringify(answer.body), { status: answer.status, headers: answer.headers });
  };
  return { calls, fetchImpl };
}

const EMAIL = 'dev@example.com';

function loginHandlers(): Record<string, Handler> {
  return {
    'POST /auth/challenge': ({ body }) => {
      const proof = Buffer.from(`hevn-developer-key-login:${body!.email}:${body!.nonce}:${body!.requestExpiry}`);
      if (!PublicKeys.verifies(String(body!.publicKey), String(body!.signature), proof))
        return { status: 401, body: { error: { code: 'invalid_credentials' } } };
      const expiry = Number(body!.requestExpiry);
      return {
        status: 200,
        body: {
          challengeId: 'c1',
          payload: payload({ message: `I am the owner of ${body!.email} ${body!.nonce}`, expiry, idempotencyKey: `developer-key-login:00ff:${body!.nonce}` }),
          expiresAt: new Date(expiry).toISOString(),
        },
      };
    },
    'POST /auth/token': () => ({
      status: 200,
      body: { accessToken: 'at-1', refreshToken: 'rt-1', expiresIn: 3600, userId: 'cl_self' },
    }),
  };
}

describe('Hevn', () => {
  const key = DeveloperKey.generate();

  it('logs in by verifying the challenge before signing it', async () => {
    const { calls, fetchImpl } = fakeApi({ ...loginHandlers(), 'GET /clients?limit=1': () => ({ status: 200, body: { items: [] } }) });
    const hevn = Hevn.connect({ key, email: EMAIL, environment: 'sandbox', fetch: fetchImpl, now: () => NOW });
    await hevn.clients.list({ limit: 1 });
    assert.deepEqual(
      calls.map((call) => `${call.method} ${call.path}`),
      ['POST /auth/challenge', 'POST /auth/token', 'GET /clients?limit=1'],
    );
    assert.equal(calls[2].headers.authorization, 'Bearer at-1');
    assert.equal(calls[2].headers['x-hevn-account'], undefined);
  });

  it('refuses to sign a challenge for another email', async () => {
    const { calls, fetchImpl } = fakeApi({
      'POST /auth/challenge': ({ body }) => ({
        status: 200,
        body: {
          challengeId: 'c1',
          payload: payload({
            message: `I am the owner of victim@example.com ${body!.nonce}`,
            expiry: Number(body!.requestExpiry),
            idempotencyKey: `developer-key-login:1:${body!.nonce}`,
          }),
          expiresAt: new Date(Number(body!.requestExpiry)).toISOString(),
        },
      }),
    });
    const hevn = Hevn.connect({ key, email: EMAIL, environment: 'sandbox', fetch: fetchImpl, now: () => NOW });
    await assert.rejects(hevn.login(), IntentRefused);
    assert.equal(calls.length, 1);
  });

  it('links a signed-in account and leaves its payouts to the holder to sign', async () => {
    const holderSigned = debitPayout({
      authorization: 'client',
      approval: null,
      debit: null,
    });
    const { calls, fetchImpl } = fakeApi({
      ...loginHandlers(),
      'POST /clients/link': ({ body }) => ({ status: 200, body: { id: 'cl_holder', code: body!.code } }),
      'POST /payouts': () => ({ status: 201, body: holderSigned }),
    });
    const hevn = Hevn.connect({ key, email: EMAIL, environment: 'sandbox', fetch: fetchImpl, now: () => NOW });

    const client = await hevn.clients.link<{ id: string; code: string }>('jwt-code');
    const { prepared, receipt } = await hevn
      .actingAs(client.id)
      .payouts.send({ contactId: 'ct_1', amount: '5.00' }, { debit: { token: 'USDC', amount: '5', address: RECIPIENT } }, { idempotencyKey: 'pay-1' });

    assert.deepEqual(client, { id: 'cl_holder', code: 'jwt-code' });
    assert.equal(prepared.authorization, 'client');
    assert.deepEqual(receipt, { id: 'po_1', status: 'awaitingSignature' });
    assert.deepEqual(
      calls.map((call) => `${call.method} ${call.path}`),
      ['POST /auth/challenge', 'POST /auth/token', 'POST /clients/link', 'POST /payouts'],
    );
  });

  it('creates a sign-in session for the browser window', async () => {
    const created = { url: 'https://sandbox.gethevn.com/connect?session=jwt', state: 'nonce-1', expiresAt: '2026-10-23T10:10:00Z' };
    const { calls, fetchImpl } = fakeApi({
      ...loginHandlers(),
      'POST /connect/sessions': () => ({ status: 201, body: created }),
    });
    const hevn = Hevn.connect({ key, email: EMAIL, environment: 'sandbox', fetch: fetchImpl, now: () => NOW });

    const issued = await hevn.connect.sessions.create({ action: 'sign', payoutId: 'po_1', redirectUri: 'https://partner.example/cb' });

    assert.deepEqual(issued, created);
    assert.deepEqual(calls[2].body, { action: 'sign', payoutId: 'po_1', redirectUri: 'https://partner.example/cb' });
    assert.equal(calls[2].headers['x-hevn-account'], undefined);
  });

  it('prepares, verifies, signs and confirms a payout until it settles', async () => {
    const prepared = debitPayout();
    const { calls, fetchImpl } = fakeApi({
      ...loginHandlers(),
      'POST /payouts': () => ({ status: 201, body: prepared }),
      'POST /payouts/po_1/confirm': [
        () => ({ status: 202, body: { id: 'po_1', status: 'submitted' } }),
        ({ body }) => {
          const bytes = Buffer.from(prepared.approval!.payload, 'base64');
          const ok = PublicKeys.verifies(String(body!.publicKey), String(body!.signature), bytes);
          return ok
            ? { status: 200, body: { id: 'po_1', status: 'settled', transactionHash: '0xfeed' } }
            : { status: 400, body: { error: { code: 'signature_invalid' } } };
        },
      ],
    });
    const hevn = Hevn.connect({ key, email: EMAIL, environment: 'sandbox', fetch: fetchImpl, now: () => NOW });
    const { receipt } = await hevn
      .actingAs('cl_7YQ2Kf3mN8')
      .payouts.send({ contactId: 'ct_1', amount: '5.00' }, { debit: { token: 'USDC', amount: '5', address: RECIPIENT } }, { idempotencyKey: 'pay-1' });

    assert.equal(receipt.status, 'settled');
    assert.equal(receipt.transactionHash, '0xfeed');
    const open = calls.find((call) => call.path === '/payouts')!;
    assert.equal(open.headers['idempotency-key'], 'pay-1');
    assert.equal(open.headers['x-hevn-account'], 'cl_7YQ2Kf3mN8');
    assert.deepEqual(open.body, { contactId: 'ct_1', amount: '5.00', publicKey: key.publicKey });
  });

  it('never confirms a payout whose debit pays someone else', async () => {
    const hijacked = debitPayout({ debit: { ...debitPayout().debit!, address: '0x2222222222222222222222222222222222222222' } });
    const { calls, fetchImpl } = fakeApi({ ...loginHandlers(), 'POST /payouts': () => ({ status: 201, body: hijacked }) });
    const hevn = Hevn.connect({ key, email: EMAIL, environment: SANDBOX, fetch: fetchImpl, now: () => NOW });
    const sending = hevn
      .actingAs('cl_7YQ2Kf3mN8')
      .payouts.send({ contactId: 'ct_1', amount: '5' }, { debit: { token: 'USDC', amount: '5', address: RECIPIENT } });
    await assert.rejects(sending, { code: 'debit_mismatch' });
    assert.equal(
      calls.some((call) => call.path.endsWith('/confirm')),
      false,
    );
  });

  it('re-opens with the same idempotency key when the approval expired unsigned', async () => {
    const { calls, fetchImpl } = fakeApi({
      ...loginHandlers(),
      'POST /payouts': [
        () => ({ status: 201, body: debitPayout() }),
        () => ({ status: 200, body: debitPayout({ approval: approval({ expiry: NOW + 100_000 }) }) }),
      ],
      'POST /payouts/po_1/confirm': [
        () => ({ status: 409, body: { error: { code: 'funding_attempt_expired' } } }),
        () => ({ status: 409, body: { error: { code: 'already_funded', details: { transactionHash: '0xdone' } } } }),
      ],
    });
    const hevn = Hevn.connect({ key, email: EMAIL, environment: 'sandbox', fetch: fetchImpl, now: () => NOW });
    const { receipt } = await hevn.payouts.send({ contactId: 'ct_1', amount: '5' }, { debit: { token: 'USDC', amount: '5' } }, { idempotencyKey: 'pay-2' });
    assert.equal(receipt.status, 'settled');
    assert.equal(receipt.transactionHash, '0xdone');
    const opens = calls.filter((call) => call.path === '/payouts');
    assert.deepEqual(
      opens.map((call) => call.headers['idempotency-key']),
      ['pay-2', 'pay-2'],
    );
  });

  it('re-mints the session once on 401 and surfaces API errors with their code', async () => {
    const { fetchImpl } = fakeApi({
      ...loginHandlers(),
      'POST /auth/refresh': () => ({ status: 200, body: { accessToken: 'at-2', expiresIn: 3600, userId: 'cl_self' } }),
      'GET /contacts/ct_9': [
        () => ({ status: 401, body: { error: { code: 'unauthenticated' } } }),
        ({ headers }) =>
          headers.authorization === 'Bearer at-2'
            ? { status: 404, body: { error: { code: 'not_found', message: 'No such contact' } } }
            : { status: 500, body: {} },
      ],
    });
    const hevn = Hevn.connect({ key, email: EMAIL, environment: 'sandbox', fetch: fetchImpl, now: () => NOW });
    await assert.rejects(hevn.contacts.get('ct_9'), (error: unknown) => error instanceof HevnApiError && error.status === 404 && error.code === 'not_found');
  });
});

// Live sandbox: runs every example end to end on the first two ready clients and checks balance changes through the SDK.
// Run: npm run test:e2e
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import type { Client, Hevn } from '../../src/index.ts';

import { connect, example, existingClients, field, sandbox, usdc, usdcChange, type Sandbox } from './harness.ts';

const AMOUNT = '0.10';
const env = sandbox();

describe('examples against the sandbox', { skip: typeof env === 'string' ? env : false, timeout: 1_200_000 }, () => {
  const sbx = env as Sandbox;
  let hevn: Hevn;
  let a: Client;
  let b: Client;

  before(async () => {
    hevn = connect(sbx);
    await hevn.login();
    [a, b] = await existingClients(hevn);
  });

  it('login.ts opens a session', async () => {
    const out = await example(sbx, 'login');
    assert.match(out, /^session for \S+ expires in \d+ s$/m);
  });

  it(`sandbox-transfer.ts credits A with ${AMOUNT} USDC and moves it to B`, async () => {
    const [aBefore, bBefore] = [await usdc(hevn, a.id), await usdc(hevn, b.id)];
    const out = await example(sbx, 'sandbox-transfer', [a.id, b.id, AMOUNT]);
    assert.equal(field(out, /^payout \S+ (\S+)/m), 'settled');
    assert.equal(await usdcChange(hevn, b.id, bBefore, Number(AMOUNT)), Number(AMOUNT));
    assert.equal(await usdcChange(hevn, a.id, aBefore, 0), 0);
  });

  it(`payout.ts sends ${AMOUNT} USDC from B to A`, async () => {
    const [aBefore, bBefore] = [await usdc(hevn, a.id), await usdc(hevn, b.id)];
    const contact = await hevn.actingAs(b.id).contacts.create<{ id: string }>({ name: `e2e ${a.id}`, account: { accountType: 'email', email: a.email } });
    const out = await example(sbx, 'payout', [b.id, contact.id, AMOUNT, a.baseSmartWallet!]);
    assert.equal(field(out, /^payout \S+ (\S+)/m), 'settled');
    assert.equal(await usdcChange(hevn, a.id, aBefore, Number(AMOUNT)), Number(AMOUNT));
    assert.equal(await usdcChange(hevn, b.id, bBefore, -Number(AMOUNT)), -Number(AMOUNT));
  });

  // A ends each run where it started, so the faucet (wallets under 1 USDC only) keeps funding it.
  it(`escrow.ts authorizes and captures ${AMOUNT} USDC from A to B`, async () => {
    const [aBefore, bBefore] = [await usdc(hevn, a.id), await usdc(hevn, b.id)];
    const out = await example(sbx, 'escrow', [a.id, b.id, AMOUNT]);
    assert.match(out, /^capture \S+ \S+$/m);
    assert.equal(await usdcChange(hevn, b.id, bBefore, Number(AMOUNT)), Number(AMOUNT));
    assert.equal(await usdcChange(hevn, a.id, aBefore, -Number(AMOUNT)), -Number(AMOUNT));
  });
});

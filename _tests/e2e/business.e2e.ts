// Live sandbox: a client company end to end — KYB, a virtual account, money in, bank payouts, a payroll run, the ledger,
// escrow returns and the swap refusal. Runs on the third and fourth ready clients so the wallet flows keep the first two.
// Run: npm run test:e2e
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { before, describe, it } from 'node:test';

import type { Client, Hevn } from '../../src/index.ts';

import { connect, example, exampleRefusal, existingClients, field, fundOwnWallet, sandbox, usdc, usdcChange, type Sandbox } from './harness.ts';

const env = sandbox();

describe('a client company against the sandbox', { skip: typeof env === 'string' ? env : false, timeout: 1_800_000 }, () => {
  const sbx = env as Sandbox;
  let hevn: Hevn;
  let company: Client; // the employer and buyer
  let supplier: Client; // the seller on the other side of an escrow
  const since = new Date().toISOString();

  before(async () => {
    hevn = connect(sbx);
    await hevn.login();
    [, , company, supplier] = await existingClients(hevn, 4);
  });

  it('onboard.ts fills the KYB document, files the application and gets it approved', async () => {
    const out = await example(sbx, 'onboard', [company.id]);
    assert.equal(field(out, /^kyb document ready (\S+)/m), 'true');
    assert.match(out, /^kyb application kyb_\S+ \S+$/m);
    assert.equal(field(out, /^kyb status (\S+)/m), 'approved');
  });

  it('kyb-rfi.ts answers a reviewer’s request for more and gets the next attempt approved', async () => {
    const out = await example(sbx, 'kyb-rfi', [company.id]);
    assert.match(out, /^kyb rfi rfi \d+ The proof of address/m);
    assert.match(out, /^kyb answered proof_of_address doc_\S+ certificate_of_incorporation doc_\S+$/m);
    const [, attempt] = out.match(/^kyb resubmitted kyb_\S+ pending (\d+)$/m) ?? [];
    assert.ok(attempt, out);
    assert.equal(field(out, /^kyb status (\S+)/m), 'approved');
    assert.match(out, new RegExp(`^kyb status approved ${attempt}$`, 'm'));
  });

  it('open-rail.ts opens a EUR SEPA virtual account in the client’s own name', async () => {
    const out = await example(sbx, 'open-rail', [company.id, 'EUR', 'sepa']);
    assert.equal(field(out, /^rail \S+ (\S+) bnk_/m), 'active');
    assert.match(out, new RegExp(`^pay to ${company.name} .*"iban":"[A-Z]{2}\\d{2}`, 'm'));
  });

  it('payin.ts quotes 0.50 EUR, hands out instructions and settles onto the wallet', async () => {
    const before = await usdc(hevn, company.id);
    const out = await example(sbx, 'payin', [company.id, '0.50', 'EUR', 'sepa']);
    assert.match(out, /^instructions bank_transfer \S+ \{"iban"/m);
    const credited = Number(field(out, /^payin pi_\S+ completed (\S+)$/m));
    assert.equal(await usdcChange(hevn, company.id, before, credited), credited);
  });

  it('sandbox-wire.ts lands an unsolicited wire on the account details', async () => {
    const before = await usdc(hevn, company.id);
    const out = await example(sbx, 'sandbox-wire', [company.id, '0.30']);
    const credited = Number(field(out, /^wire \S+ settled (\S+) USDC txn_/m));
    assert.equal(await usdcChange(hevn, company.id, before, credited), credited);
  });

  it('bank-payout.ts pays 0.20 USDC to a SEPA beneficiary and settles it', async () => {
    const before = await usdc(hevn, company.id);
    const out = await example(sbx, 'bank-payout', [company.id, '0.20', 'settled']);
    assert.match(out, /^option sepa EUR .* ok$/m);
    assert.equal(field(out, /^payout status (\S+)/m), 'settled');
    assert.equal(await usdcChange(hevn, company.id, before, -0.2), -0.2);
  });

  // Kept more than 0.20 away from every other payout: the sandbox attributes returned money by amount.
  it('bank-payout.ts gets a 0.50 payout refunded back to the wallet', async () => {
    const before = await usdc(hevn, company.id);
    const out = await example(sbx, 'bank-payout', [company.id, '0.50', 'refunded']);
    assert.equal(field(out, /^payout status (\S+)/m), 'refunded');
    assert.equal(await usdcChange(hevn, company.id, before, 0), 0);
  });

  it('payroll.ts pays two contractors once, however many times the run is driven', async () => {
    const run = `run-${randomUUID().slice(0, 8)}`;
    const before = await usdc(hevn, company.id);
    const first = await example(sbx, 'payroll', [company.id, run, '0.10']);
    const again = await example(sbx, 'payroll', [company.id, run, '0.10']);
    const paid = (out: string) => [...out.matchAll(/^paid (\S+) (po_\S+)/gm)].map((m) => `${m[1]} ${m[2]}`);
    assert.equal(paid(first).length, 2);
    assert.deepEqual(paid(again), paid(first));
    assert.equal(await usdcChange(hevn, company.id, before, -0.2), -0.2);
  });

  it('ledger.ts walks the day’s rows, totals them and exports files', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'dapi-ledger-'));
    const out = await example(sbx, 'ledger', [company.id, since, outDir]);
    assert.match(out, /^row txn_\S+ \S+ success in .* Payer GmbH$/m);
    assert.match(out, /^row txn_\S+ \S+ success in .* ACME GmbH$/m);
    assert.ok(Number(field(out, /^summary in (\S+)/m)) > 0);
    const files = [...out.matchAll(/^export (\S+)$/gm)].map((m) => m[1]!);
    assert.ok(files.some((file) => file.endsWith('.csv')) && files.some((file) => file.endsWith('-statement.pdf')), out);
    for (const file of files) assert.ok(existsSync(file), file);
  });

  it('escrow-partial.ts captures what shipped and voids the rest back to the buyer', async () => {
    const [buyerBefore, sellerBefore] = [await usdc(hevn, company.id), await usdc(hevn, supplier.id)];
    const out = await example(sbx, 'escrow-partial', [company.id, supplier.id, '0.30', '0.10']);
    assert.equal(field(out, /^void \S+ (\S+)$/m), 'voided');
    assert.equal(await usdcChange(hevn, supplier.id, sellerBefore, 0.1), 0.1);
    assert.equal(await usdcChange(hevn, company.id, buyerBefore, -0.1), -0.1);
  });

  it('escrow-refund.ts charges the buyer, then refunds from the operator’s own wallet', async () => {
    await fundOwnWallet(hevn, 0.1);
    const [buyerBefore, sellerBefore] = [await usdc(hevn, company.id), await usdc(hevn, supplier.id)];
    const out = await example(sbx, 'escrow-refund', [company.id, supplier.id, '0.10']);
    assert.equal(field(out, /^refund \S+ (\S+)/m), 'refunded');
    assert.equal(await usdcChange(hevn, supplier.id, sellerBefore, 0.1), 0.1);
    assert.equal(await usdcChange(hevn, company.id, buyerBefore, 0), 0);
  });

  it('swap.ts is refused in the sandbox, which has no exchange venue', async () => {
    const out = await exampleRefusal(sbx, 'swap', [company.id, 'USDC', 'EURC', '0.20'], 2);
    assert.match(out, /^swap refused: 422 swap_route_unavailable /m);
  });
});

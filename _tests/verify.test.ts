import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  AuthorizationPayload,
  CanonicalJson,
  IntentRefused,
  IntentVerifier,
  type CoSignExpectation,
  type Debit,
  type EscrowActionResult,
  type RefusalCode,
} from '../src/index.ts';

import {
  BACKEND_PERSONAL_PAYLOAD,
  BACKEND_REPLAY_SAFE_HASH,
  BACKEND_SECP_PAYLOAD,
  DIGEST,
  NOW,
  RECIPIENT,
  SANDBOX,
  SMART_WALLET,
  approval,
  debitPayout,
  intentPayout,
  payload,
  verifier,
} from './fixtures.ts';

const DEBIT: CoSignExpectation = { debit: { token: 'USDC', amount: '5', address: RECIPIENT } };

function refusal(run: () => unknown): IntentRefused {
  try {
    run();
  } catch (error) {
    if (error instanceof IntentRefused) return error;
    throw error;
  }
  throw new Error('expected a refusal');
}

function refuses(code: RefusalCode, run: () => unknown): void {
  assert.equal(refusal(run).code, code);
}

describe('AuthorizationPayload', () => {
  it('reads payloads the backend encodes, byte for byte', () => {
    const secp = AuthorizationPayload.decode(BACKEND_SECP_PAYLOAD);
    assert.equal(secp.walletId, 'abc123xyz');
    assert.equal(secp.appId, SANDBOX.privyAppId);
    assert.equal(secp.expiresAt, 1773679531000);
    assert.deepEqual(secp.request.body, { method: 'secp256k1_sign', params: { hash: `0x${'ab'.repeat(32)}` } });
    assert.ok(CanonicalJson.bytes(secp.request).equals(secp.bytes));

    const personal = AuthorizationPayload.personalSign(AuthorizationPayload.decode(BACKEND_PERSONAL_PAYLOAD));
    assert.equal(personal.request.body.params.message, 'I am the owner of jürgen@exämple.com 42\t"x"');
    assert.equal(personal.idempotencyKey, 'developer-key-login:00ff:42');
  });

  it('refuses non-canonical bytes, so duplicate keys cannot hide a second hash', () => {
    const raw = Buffer.from(BACKEND_SECP_PAYLOAD, 'base64').toString();
    const spaced = Buffer.from(JSON.stringify(JSON.parse(raw), null, 1)).toString('base64');
    refuses('payload_not_canonical', () => AuthorizationPayload.decode(spaced));
    const duplicated = raw.replace('"params":{"hash"', `"params":{"hash":"0x${'cd'.repeat(32)}","hash"`);
    refuses('payload_not_canonical', () => AuthorizationPayload.decode(Buffer.from(duplicated).toString('base64')));
  });

  it('refuses anything but one wallet RPC call', () => {
    refuses('payload_unreadable', () => AuthorizationPayload.decode('not base64!'));
    refuses('not_wallet_rpc', () => AuthorizationPayload.decode(payload({ url: 'https://api.privy.io/v1/wallets/abc/rpc/../x' })));
    refuses('not_wallet_rpc', () => AuthorizationPayload.decode(payload({ url: 'https://evil.example/v1/wallets/abc/rpc' })));
    refuses('not_wallet_rpc', () => AuthorizationPayload.decode(payload({ extra: { extra: 1 } })));
    refuses('unexpected_rpc', () => AuthorizationPayload.decode(payload({ hash: '0x1234' })));
    const typed = CanonicalJson.bytes({
      version: 1,
      method: 'POST',
      url: 'https://api.privy.io/v1/wallets/abc/rpc',
      headers: { 'privy-app-id': SANDBOX.privyAppId, 'privy-request-expiry': String(NOW + 1000) },
      body: { method: 'eth_signTypedData_v4', params: { typed_data: {} } },
    }).toString('base64');
    refuses('unexpected_rpc', () => AuthorizationPayload.decode(typed));
  });
});

describe('IntentVerifier.coSign — debit', () => {
  it('accepts a debit that matches the intended payment', () => {
    const decoded = verifier().coSign(debitPayout(), DEBIT, 120_000);
    assert.equal(decoded.request.body.params.hash, `0x${'ab'.repeat(32)}`);
  });

  const changes: [string, Partial<Debit>][] = [
    ['address', { address: '0x2222222222222222222222222222222222222222' }],
    ['amount', { amount: '50.00', amountAtomic: '50000000' }],
    ['amountAtomic', { amountAtomic: '5000001' }],
    ['token', { token: 'EURC' }],
    ['chainId', { chainId: 8453 }],
  ];
  for (const [field, change] of changes) {
    it(`refuses a debit whose ${field} differs`, () => {
      const payout = debitPayout({ debit: { ...debitPayout().debit!, ...change } });
      const error = refusal(() => verifier().coSign(payout, DEBIT, 120_000));
      assert.equal(error.code, 'debit_mismatch');
      assert.equal(error.details.field, field);
    });
  }

  it('refuses an intent where a debit was expected, and the reverse', () => {
    refuses('authorization_kind', () => verifier().coSign(intentPayout(), DEBIT, 120_000));
    refuses('authorization_kind', () => verifier().coSign(debitPayout(), { intent: { smartWallet: SMART_WALLET } }, 120_000));
  });

  it('refuses another environment, a stale approval and an over-long window', () => {
    refuses('wrong_environment', () => verifier().coSign(debitPayout({ approval: approval({ appId: 'cmnueil3100ix0djpyc86514h' }) }), DEBIT, 120_000));
    refuses('approval_expired', () => verifier(NOW + 121_000).coSign(debitPayout(), DEBIT, 120_000));
    refuses('approval_window', () => verifier().coSign(debitPayout({ approval: approval({ expiry: NOW + 3_600_000 }) }), DEBIT, 120_000));
    const lying = { ...approval(), expiresAt: new Date(NOW + 60_000).toISOString() };
    refuses('expiry_mismatch', () => verifier().coSign(debitPayout({ approval: lying }), DEBIT, 120_000));
  });

  it('checks the quote when asked', () => {
    verifier().coSign(debitPayout(), { ...DEBIT, quote: { fromAmount: '5', maxFeeAmount: '0.10' } }, 120_000);
    refuses('quote_mismatch', () => verifier().coSign(debitPayout(), { ...DEBIT, quote: { toAmount: '6' } }, 120_000));
  });
});

describe('IntentVerifier.coSign — intent', () => {
  it('matches the backend replay-safe wrap', () => {
    assert.equal(IntentVerifier.replaySafeHash(SMART_WALLET, 84532, DIGEST), BACKEND_REPLAY_SAFE_HASH);
  });

  it('accepts an approval that signs intent.digest wrapped for the client wallet', () => {
    verifier().coSign(intentPayout(), { intent: { smartWallet: SMART_WALLET }, quote: { fromAmount: '500', toCurrency: 'EUR', minToAmount: '460' } }, 120_000);
  });

  it('refuses the raw digest, another wallet and another chain', () => {
    const intent = { intent: { smartWallet: SMART_WALLET } };
    refuses('intent_mismatch', () => verifier().coSign(intentPayout({ approval: approval({ hash: DIGEST }) }), intent, 120_000));
    refuses('intent_mismatch', () =>
      verifier().coSign(intentPayout(), { intent: { smartWallet: '0x9999999999999999999999999999999999999999' } }, 120_000),
    );
    const mainnet = intentPayout({ approval: approval({ hash: IntentVerifier.replaySafeHash(SMART_WALLET, 8453, DIGEST) }) });
    refuses('intent_mismatch', () => verifier().coSign(mainnet, intent, 120_000));
  });
});

describe('IntentVerifier.login', () => {
  const email = 'dev@example.com';
  const nonce = 481923756104;
  const requestExpiry = NOW + 120_000;
  const expected = { email, nonce, requestExpiry };
  const challenge = (message: string, key = `developer-key-login:00ff:${nonce}`) => ({
    challengeId: 'c1',
    payload: payload({ message, expiry: requestExpiry, idempotencyKey: key }),
    expiresAt: new Date(requestExpiry).toISOString(),
  });

  it('accepts the ownership proof for this email and nonce', () => {
    assert.equal(verifier().login(challenge(`I am the owner of ${email} ${nonce}`), expected).request.body.method, 'personal_sign');
  });

  it('refuses a challenge that signs anything else', () => {
    refuses('challenge_mismatch', () => verifier().login(challenge(`I am the owner of other@example.com ${nonce}`), expected));
    refuses('challenge_mismatch', () => verifier().login(challenge(`I am the owner of ${email} ${nonce}`, 'x:1'), expected));
    refuses('unexpected_rpc', () => verifier().login({ challengeId: 'c1', payload: payload({ expiry: requestExpiry }), expiresAt: '' }, expected));
  });
});

describe('IntentVerifier.escrow', () => {
  const result = (overrides: Partial<EscrowActionResult['action']> = {}): EscrowActionResult => ({
    deal: {} as EscrowActionResult['deal'],
    action: {
      action: 'capture',
      idempotencyKey: 'order-1-capture',
      status: 'awaitingSignature',
      amount: '40.000000',
      feeBps: 250,
      approval: approval({ expiry: NOW + 60_000 }),
      ...overrides,
    },
    events: [],
  });

  it('accepts the action that was asked for', () => {
    verifier().escrow(result(), { action: 'capture', amount: '40', feeBps: 250, idempotencyKey: 'order-1-capture' });
  });

  it('refuses another verb, amount, fee or a 120s approval', () => {
    refuses('escrow_mismatch', () => verifier().escrow(result({ action: 'refund' }), { action: 'capture', amount: '40' }));
    refuses('escrow_mismatch', () => verifier().escrow(result(), { action: 'capture', amount: '41' }));
    refuses('escrow_mismatch', () => verifier().escrow(result(), { action: 'capture', amount: '40', feeBps: 0 }));
    refuses('approval_window', () => verifier().escrow(result({ approval: approval() }), { action: 'capture', amount: '40' }));
  });
});

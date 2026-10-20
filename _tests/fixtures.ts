import { CanonicalJson, ENVIRONMENTS, IntentVerifier, type Approval, type Payout } from '../src/index.ts';

export const SANDBOX = ENVIRONMENTS.sandbox;
export const NOW = 1_773_679_500_000;
export const WALLET_ID = 'abc123xyz';
export const SMART_WALLET = '0x8f3bd1c7a0e94f25b6d1c83a5e07f4b219ad6e80' as const;
export const RECIPIENT = '0x1111111111111111111111111111111111111111' as const;
export const USER_OP_HASH = `0x${'ab'.repeat(32)}` as const;
export const DIGEST = `0x${'51'.repeat(32)}` as const;

export const BACKEND_SECP_PAYLOAD =
  'eyJib2R5Ijp7Im1ldGhvZCI6InNlY3AyNTZrMV9zaWduIiwicGFyYW1zIjp7Imhhc2giOiIweGFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWIifX0sImhlYWRlcnMiOnsicHJpdnktYXBwLWlkIjoiY211NGRpdmNxMDAwejBianNyNWM3a2czNSIsInByaXZ5LXJlcXVlc3QtZXhwaXJ5IjoiMTc3MzY3OTUzMTAwMCJ9LCJtZXRob2QiOiJQT1NUIiwidXJsIjoiaHR0cHM6Ly9hcGkucHJpdnkuaW8vdjEvd2FsbGV0cy9hYmMxMjN4eXovcnBjIiwidmVyc2lvbiI6MX0=';
export const BACKEND_PERSONAL_PAYLOAD =
  'eyJib2R5Ijp7Im1ldGhvZCI6InBlcnNvbmFsX3NpZ24iLCJwYXJhbXMiOnsiZW5jb2RpbmciOiJ1dGYtOCIsIm1lc3NhZ2UiOiJJIGFtIHRoZSBvd25lciBvZiBqw7xyZ2VuQGV4w6RtcGxlLmNvbSA0Mlx0XCJ4XCIifX0sImhlYWRlcnMiOnsicHJpdnktYXBwLWlkIjoiY211NGRpdmNxMDAwejBianNyNWM3a2czNSIsInByaXZ5LWlkZW1wb3RlbmN5LWtleSI6ImRldmVsb3Blci1rZXktbG9naW46MDBmZjo0MiIsInByaXZ5LXJlcXVlc3QtZXhwaXJ5IjoiMTc3MzY3OTUzMTAwMCJ9LCJtZXRob2QiOiJQT1NUIiwidXJsIjoiaHR0cHM6Ly9hcGkucHJpdnkuaW8vdjEvd2FsbGV0cy9hYmMxMjN4eXovcnBjIiwidmVyc2lvbiI6MX0=';
export const BACKEND_REPLAY_SAFE_HASH = '0xa52598749cd350e218fdb719a47a82032bf085da93316d7e59f8acbba1dd6335';

export interface PayloadParts {
  hash?: string;
  message?: string;
  expiry?: number;
  appId?: string;
  url?: string;
  idempotencyKey?: string;
  extra?: Record<string, unknown>;
}

export function payload(parts: PayloadParts = {}): string {
  const body =
    parts.message !== undefined
      ? { method: 'personal_sign', params: { message: parts.message, encoding: 'utf-8' } }
      : { method: 'secp256k1_sign', params: { hash: parts.hash ?? USER_OP_HASH } };
  const headers: Record<string, string> = {
    'privy-app-id': parts.appId ?? SANDBOX.privyAppId,
    'privy-request-expiry': String(parts.expiry ?? NOW + 120_000),
  };
  if (parts.idempotencyKey) headers['privy-idempotency-key'] = parts.idempotencyKey;
  const document = {
    version: 1,
    method: 'POST',
    url: parts.url ?? `https://api.privy.io/v1/wallets/${WALLET_ID}/rpc`,
    headers,
    body,
    ...parts.extra,
  };
  return CanonicalJson.bytes(document).toString('base64');
}

export function approval(parts: PayloadParts = {}): Approval {
  const expiry = parts.expiry ?? NOW + 120_000;
  return { id: 'apr_1', payload: payload({ ...parts, expiry }), expiresAt: new Date(expiry).toISOString() };
}

export function debitPayout(overrides: Partial<Payout> = {}): Payout {
  return {
    id: 'po_1',
    kind: 'onchain',
    status: 'awaitingSignature',
    idempotencyKey: 'k1',
    authorization: 'debit',
    approval: approval(),
    debit: { address: RECIPIENT, amount: '5.00', amountAtomic: '5000000', token: 'USDC', chainId: SANDBOX.chainId },
    intent: null,
    quote: { fromAmount: '5.00', fromCurrency: 'USDC', sourceAccount: 'USDC', toAmount: '5.00', toCurrency: 'USDC', feeAmount: '0.00' },
    contact: null,
    ...overrides,
  };
}

export function intentPayout(overrides: Partial<Payout> = {}): Payout {
  const hash = IntentVerifier.replaySafeHash(SMART_WALLET, SANDBOX.chainId, DIGEST);
  return debitPayout({
    kind: 'fiat',
    authorization: 'intent',
    approval: approval({ hash }),
    debit: null,
    intent: { digest: DIGEST, settles: 'message_signature' },
    quote: { fromAmount: '500.00', fromCurrency: 'USD', sourceAccount: 'FDIC_USD', toAmount: '462.14', toCurrency: 'EUR', feeAmount: '1.50' },
    ...overrides,
  });
}

export function verifier(now = NOW): IntentVerifier {
  return new IntentVerifier({ environment: SANDBOX, now: () => now });
}

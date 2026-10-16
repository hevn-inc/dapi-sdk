import { Base64, CanonicalJson, HexCheck } from './encoding.ts';
import type { AuthorizationHeaders, AuthorizationRequest, PersonalSignRpc, SecpSignRpc, WalletRpc } from './intents.ts';

export type RefusalCode =
  | 'payload_unreadable'
  | 'payload_not_canonical'
  | 'not_wallet_rpc'
  | 'unexpected_rpc'
  | 'wrong_environment'
  | 'expiry_mismatch'
  | 'approval_expired'
  | 'approval_window'
  | 'authorization_kind'
  | 'debit_mismatch'
  | 'intent_mismatch'
  | 'quote_mismatch'
  | 'challenge_mismatch'
  | 'escrow_mismatch';

export class IntentRefused extends Error {
  override name = 'IntentRefused';
  readonly code: RefusalCode;
  readonly details: Record<string, unknown>;

  constructor(code: RefusalCode, message: string, details: Record<string, unknown> = {}) {
    super(`${message} Nothing was signed.`);
    this.code = code;
    this.details = details;
  }
}

export interface DecodedAuthorization<Body extends WalletRpc = WalletRpc> {
  bytes: Buffer;
  request: AuthorizationRequest<Body>;
  walletId: string;
  appId: string;
  expiresAt: number;
  idempotencyKey: string | null;
}

export class AuthorizationPayload {
  static readonly RPC_URL = /^https:\/\/api\.privy\.io\/v1\/wallets\/([A-Za-z0-9_-]+)\/rpc$/;
  static readonly TOP_LEVEL = 'body,headers,method,url,version';
  static readonly HEADERS = new Set(['privy-app-id', 'privy-request-expiry', 'privy-idempotency-key']);

  static decode(payload: string): DecodedAuthorization {
    let bytes: Buffer;
    let request: AuthorizationRequest;
    try {
      bytes = Base64.decode(payload, 'approval.payload');
      request = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
      throw new IntentRefused('payload_unreadable', 'The approval payload is not base64 of a UTF-8 JSON document.');
    }
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
      throw new IntentRefused('payload_unreadable', 'The approval payload is not a JSON object.');
    }
    if (!CanonicalJson.bytes(request).equals(bytes)) {
      throw new IntentRefused('payload_not_canonical', 'The approval payload is not canonical JSON, so its keys could be read two ways.');
    }
    if (Object.keys(request).sort().join() !== AuthorizationPayload.TOP_LEVEL || request.version !== 1 || request.method !== 'POST') {
      throw new IntentRefused('not_wallet_rpc', 'The approval payload is not a version 1 POST authorization.');
    }
    const walletId = typeof request.url === 'string' ? request.url.match(AuthorizationPayload.RPC_URL)?.[1] : undefined;
    if (!walletId) throw new IntentRefused('not_wallet_rpc', 'The approval payload does not call a Privy wallet RPC.', { url: request.url });

    const headers = AuthorizationPayload.headers(request.headers);
    AuthorizationPayload.body(request.body);
    return {
      bytes,
      request,
      walletId,
      appId: headers['privy-app-id'],
      expiresAt: Number(headers['privy-request-expiry']),
      idempotencyKey: headers['privy-idempotency-key'] ?? null,
    };
  }

  static secp256k1(decoded: DecodedAuthorization): DecodedAuthorization<SecpSignRpc> {
    if (decoded.request.body.method !== 'secp256k1_sign') {
      throw new IntentRefused('unexpected_rpc', `The approval asks for ${decoded.request.body.method}, not secp256k1_sign of one hash.`);
    }
    return decoded as DecodedAuthorization<SecpSignRpc>;
  }

  static personalSign(decoded: DecodedAuthorization): DecodedAuthorization<PersonalSignRpc> {
    if (decoded.request.body.method !== 'personal_sign') {
      throw new IntentRefused('unexpected_rpc', `The approval asks for ${decoded.request.body.method}, not personal_sign of one text.`);
    }
    return decoded as DecodedAuthorization<PersonalSignRpc>;
  }

  private static headers(headers: unknown): AuthorizationHeaders {
    if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
      throw new IntentRefused('not_wallet_rpc', 'The approval payload carries no signed headers.');
    }
    const record = headers as Record<string, unknown>;
    const unknown = Object.keys(record).filter((name) => !AuthorizationPayload.HEADERS.has(name));
    if (unknown.length) throw new IntentRefused('not_wallet_rpc', 'The approval payload signs headers this SDK does not know.', { headers: unknown });
    if (Object.values(record).some((value) => typeof value !== 'string')) {
      throw new IntentRefused('not_wallet_rpc', 'The approval payload signs a non-string header.');
    }
    const appId = record['privy-app-id'];
    const expiry = record['privy-request-expiry'];
    if (typeof appId !== 'string' || !appId) throw new IntentRefused('wrong_environment', 'The approval payload names no Privy app.');
    if (typeof expiry !== 'string' || !/^\d{13}$/.test(expiry)) {
      throw new IntentRefused('expiry_mismatch', 'The approval payload carries no millisecond request expiry.');
    }
    return record as unknown as AuthorizationHeaders;
  }

  private static body(body: unknown): asserts body is WalletRpc {
    const rpc = body as { method?: unknown; params?: Record<string, unknown> } | null;
    const params = rpc?.params;
    const shaped =
      rpc && typeof rpc === 'object' && Object.keys(rpc).sort().join() === 'method,params' && params && typeof params === 'object' && !Array.isArray(params);
    if (!shaped) throw new IntentRefused('unexpected_rpc', 'The approval body is not one wallet RPC call.');
    const keys = Object.keys(params).sort().join();
    if (rpc.method === 'secp256k1_sign' && keys === 'hash' && HexCheck.isHash(params.hash)) return;
    if (rpc.method === 'personal_sign' && keys === 'encoding,message' && params.encoding === 'utf-8' && typeof params.message === 'string') return;
    throw new IntentRefused('unexpected_rpc', 'The approval does more than sign one hash or one text.', { method: rpc.method });
  }
}

import { keccak_256 } from '@noble/hashes/sha3.js';

import { Decimal, HexCheck } from './encoding.ts';
import { APPROVAL_WINDOW_MS, TOKENS, type Environment } from './environment.ts';
import type {
  Approval,
  CoSignable,
  CoSignExpectation,
  Debit,
  EscrowActionResult,
  ExpectedDebit,
  ExpectedEscrowAction,
  ExpectedIntent,
  ExpectedQuote,
  Hex as HexString,
  Intent,
  LoginChallenge,
  PersonalSignRpc,
  Quote,
  SecpSignRpc,
} from './intents.ts';
import { AuthorizationPayload, IntentRefused, type DecodedAuthorization } from './payload.ts';

export interface VerifierOptions {
  environment: Environment;
  now?: () => number;
  clockSkewMs?: number;
}

export interface LoginExpectation {
  email: string;
  nonce: number | bigint;
  requestExpiry: number;
}

export class IntentVerifier {
  static readonly LOGIN_PREFIX = 'I am the owner of';
  static readonly LOGIN_KEY_PREFIX = 'developer-key-login:';
  static readonly EXPIRY_TOLERANCE_MS = 1_000;

  readonly environment: Environment;
  readonly #now: () => number;
  readonly #skew: number;

  constructor(options: VerifierOptions) {
    this.environment = options.environment;
    this.#now = options.now ?? Date.now;
    this.#skew = options.clockSkewMs ?? 5_000;
  }

  static replaySafeHash(account: HexString, chainId: number, digest: HexString): HexString {
    if (!HexCheck.isAddress(account) || !HexCheck.isHash(digest)) throw new TypeError('replaySafeHash takes an address and a 32-byte digest');
    const word = (value: bigint) => Buffer.from(value.toString(16).padStart(64, '0'), 'hex');
    const keccak = (...parts: Uint8Array[]) => Buffer.from(keccak_256(Buffer.concat(parts)));
    const text = (value: string) => keccak(Buffer.from(value, 'utf8'));
    const domain = keccak(
      text('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'),
      text('Coinbase Smart Wallet'),
      text('1'),
      word(BigInt(chainId)),
      word(BigInt(account)),
    );
    const message = keccak(text('CoinbaseSmartWalletMessage(bytes32 hash)'), Buffer.from(digest.slice(2), 'hex'));
    return `0x${keccak(Buffer.from([0x19, 0x01]), domain, message).toString('hex')}`;
  }

  static loginText(email: string, nonce: number | bigint): string {
    return `${IntentVerifier.LOGIN_PREFIX} ${email} ${nonce}`;
  }

  approval(approval: Approval | null | undefined, windowMs: number): DecodedAuthorization {
    if (!approval?.payload) throw new IntentRefused('payload_unreadable', 'The response carries no approval to sign.');
    const decoded = AuthorizationPayload.decode(approval.payload);
    this.requireEnvironment(decoded);
    const declared = Date.parse(approval.expiresAt);
    if (!Number.isFinite(declared) || Math.abs(declared - decoded.expiresAt) > IntentVerifier.EXPIRY_TOLERANCE_MS) {
      throw new IntentRefused('expiry_mismatch', 'The signed request expiry differs from approval.expiresAt.', {
        signed: decoded.expiresAt,
        declared: approval.expiresAt,
      });
    }
    this.requireLive(decoded.expiresAt, windowMs);
    return decoded;
  }

  login(challenge: LoginChallenge, expected: LoginExpectation): DecodedAuthorization<PersonalSignRpc> {
    const decoded = AuthorizationPayload.personalSign(AuthorizationPayload.decode(challenge.payload));
    this.requireEnvironment(decoded);
    const text = IntentVerifier.loginText(expected.email, expected.nonce);
    if (decoded.request.body.params.message !== text) {
      throw new IntentRefused('challenge_mismatch', 'The login challenge signs a text other than the ownership proof for this email and nonce.', {
        signed: decoded.request.body.params.message,
        expected: text,
      });
    }
    if (decoded.expiresAt !== expected.requestExpiry) {
      throw new IntentRefused('challenge_mismatch', 'The login challenge carries another request expiry than the proof.');
    }
    const key = decoded.idempotencyKey;
    if (!key || !key.startsWith(IntentVerifier.LOGIN_KEY_PREFIX) || !key.endsWith(`:${expected.nonce}`)) {
      throw new IntentRefused('challenge_mismatch', 'The login challenge is not bound to this nonce.');
    }
    this.requireLive(decoded.expiresAt, APPROVAL_WINDOW_MS.login);
    return decoded;
  }

  coSign(prepared: CoSignable, expected: CoSignExpectation, windowMs: number): DecodedAuthorization<SecpSignRpc> {
    const decoded = AuthorizationPayload.secp256k1(this.approval(prepared.approval, windowMs));
    const allowed = expected.allow ?? (['debit', 'intent'] as const).filter((kind) => expected[kind] !== undefined);
    if (!allowed.includes(prepared.authorization)) {
      throw new IntentRefused('authorization_kind', `The approval authorizes a ${prepared.authorization}, which this payment did not expect.`, {
        authorization: prepared.authorization,
      });
    }
    if (expected.quote) this.quote(prepared.quote, expected.quote);
    if (prepared.authorization === 'debit') {
      if (!expected.debit) throw new IntentRefused('authorization_kind', 'The approval authorizes a debit, and no expected debit was given.');
      if (prepared.intent) throw new IntentRefused('authorization_kind', 'A debit approval also carries intent terms.');
      this.debit(prepared.debit, expected.debit);
      return decoded;
    }
    if (prepared.authorization === 'intent') {
      if (!expected.intent) throw new IntentRefused('authorization_kind', 'The approval authorizes an intent, and no smart wallet was given to check it against.');
      if (prepared.debit) throw new IntentRefused('authorization_kind', 'An intent approval also carries a debit.');
      this.intent(prepared.intent, decoded.request.body.params.hash, expected.intent);
      return decoded;
    }
    throw new IntentRefused('authorization_kind', `Unknown authorization ${String(prepared.authorization)}.`);
  }

  debit(debit: Debit | null | undefined, expected: ExpectedDebit): Debit {
    if (!debit) throw new IntentRefused('debit_mismatch', 'The approval authorizes a debit, and the response does not describe it.');
    const mismatch = (field: string, actual: unknown, wanted: unknown) =>
      new IntentRefused('debit_mismatch', `debit.${field} is ${String(actual)}, expected ${String(wanted)}.`, { field, actual, expected: wanted });

    if (debit.chainId !== this.environment.chainId) throw mismatch('chainId', debit.chainId, this.environment.chainId);
    if (debit.token !== expected.token) throw mismatch('token', debit.token, expected.token);
    const token = TOKENS[debit.token];
    if (!token) throw mismatch('token', debit.token, Object.keys(TOKENS).join(' or '));
    if (!HexCheck.isAddress(debit.address)) throw mismatch('address', debit.address, 'a 20-byte address');
    if (expected.address && !HexCheck.same(debit.address, expected.address)) throw mismatch('address', debit.address, expected.address);
    if (!/^\d+$/.test(debit.amountAtomic)) throw mismatch('amountAtomic', debit.amountAtomic, 'an integer');

    const atomic = BigInt(debit.amountAtomic);
    let described: bigint;
    let wanted: bigint;
    try {
      described = Decimal.toUnits(debit.amount, token.decimals);
      wanted = Decimal.toUnits(expected.amount, token.decimals);
    } catch {
      throw mismatch('amount', debit.amount, expected.amount);
    }
    if (described !== atomic) throw mismatch('amountAtomic', debit.amountAtomic, `${described} (debit.amount ${debit.amount})`);
    if (atomic !== wanted) throw mismatch('amount', debit.amount, expected.amount);
    if (atomic <= 0n) throw mismatch('amount', debit.amount, 'a positive amount');
    return debit;
  }

  intent(intent: Intent | null | undefined, signedHash: HexString, expected: ExpectedIntent): Intent {
    if (!intent || !HexCheck.isHash(intent.digest)) {
      throw new IntentRefused('intent_mismatch', 'The approval authorizes an intent, and the response carries no 32-byte digest.');
    }
    if (!HexCheck.isAddress(expected.smartWallet)) throw new IntentRefused('intent_mismatch', 'The expected smart wallet is not an address.');
    if (expected.settles && intent.settles !== expected.settles) {
      throw new IntentRefused('intent_mismatch', `The intent settles by ${intent.settles}, expected ${expected.settles}.`);
    }
    if (HexCheck.same(signedHash, intent.digest)) {
      throw new IntentRefused('intent_mismatch', 'The approval signs the raw digest instead of its smart-wallet replay-safe wrap.');
    }
    const wrapped = IntentVerifier.replaySafeHash(expected.smartWallet, this.environment.chainId, intent.digest);
    if (!HexCheck.same(signedHash, wrapped)) {
      throw new IntentRefused('intent_mismatch', 'The approval signs something other than intent.digest for this smart wallet.', {
        signed: signedHash,
        expected: wrapped,
        smartWallet: expected.smartWallet,
      });
    }
    return intent;
  }

  quote(quote: Quote | null | undefined, expected: ExpectedQuote): Quote {
    if (!quote) throw new IntentRefused('quote_mismatch', 'The response carries no quote to check.');
    const refuse = (field: string, actual: unknown, wanted: unknown) =>
      new IntentRefused('quote_mismatch', `quote.${field} is ${String(actual)}, expected ${String(wanted)}.`, { field, actual, expected: wanted });

    if (expected.fromCurrency && quote.fromCurrency !== expected.fromCurrency) throw refuse('fromCurrency', quote.fromCurrency, expected.fromCurrency);
    if (expected.toCurrency && quote.toCurrency !== expected.toCurrency) throw refuse('toCurrency', quote.toCurrency, expected.toCurrency);
    if (expected.fromAmount && !Decimal.equal(quote.fromAmount, expected.fromAmount)) throw refuse('fromAmount', quote.fromAmount, expected.fromAmount);
    if (expected.toAmount && !Decimal.equal(quote.toAmount, expected.toAmount)) throw refuse('toAmount', quote.toAmount, expected.toAmount);
    if (expected.minToAmount && Decimal.compare(quote.toAmount, expected.minToAmount) < 0) {
      throw refuse('toAmount', quote.toAmount, `at least ${expected.minToAmount}`);
    }
    if (expected.maxFeeAmount && quote.feeAmount != null && Decimal.compare(quote.feeAmount, expected.maxFeeAmount) > 0) {
      throw refuse('feeAmount', quote.feeAmount, `at most ${expected.maxFeeAmount}`);
    }
    return quote;
  }

  escrow(result: EscrowActionResult, expected: ExpectedEscrowAction): DecodedAuthorization<SecpSignRpc> {
    const { action } = result;
    const refuse = (field: string, actual: unknown, wanted: unknown) =>
      new IntentRefused('escrow_mismatch', `action.${field} is ${String(actual)}, expected ${String(wanted)}.`, { field, actual, expected: wanted });

    if (action.action !== expected.action) throw refuse('action', action.action, expected.action);
    if (action.status !== 'awaitingSignature') throw refuse('status', action.status, 'awaitingSignature');
    if (expected.idempotencyKey && action.idempotencyKey !== expected.idempotencyKey) {
      throw refuse('idempotencyKey', action.idempotencyKey, expected.idempotencyKey);
    }
    if (expected.amount !== undefined) {
      if (action.amount == null || !Decimal.equal(action.amount, expected.amount)) throw refuse('amount', action.amount, expected.amount);
    } else if (action.amount != null && expected.action !== 'approve') {
      throw refuse('amount', action.amount, 'none');
    }
    if (expected.feeBps !== undefined && (action.feeBps ?? 0) !== expected.feeBps) throw refuse('feeBps', action.feeBps, expected.feeBps);
    return AuthorizationPayload.secp256k1(this.approval(action.approval, APPROVAL_WINDOW_MS.escrow));
  }

  private requireEnvironment(decoded: DecodedAuthorization): void {
    if (decoded.appId !== this.environment.privyAppId) {
      throw new IntentRefused('wrong_environment', `The approval is bound to Privy app ${decoded.appId}, not ${this.environment.name}.`, {
        appId: decoded.appId,
      });
    }
  }

  private requireLive(expiresAt: number, windowMs: number): void {
    const now = this.#now();
    if (expiresAt <= now) throw new IntentRefused('approval_expired', 'The approval has already expired.', { expiresAt, now });
    if (expiresAt - now > windowMs + this.#skew) {
      throw new IntentRefused('approval_window', `The approval stays open longer than ${windowMs / 1000}s.`, { expiresAt, now });
    }
  }
}

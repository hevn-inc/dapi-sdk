import { randomInt } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

import type { Environment } from './environment.ts';
import type { ClientId, LoginChallenge, Tokens } from './intents.ts';
import type { DeveloperKey } from './key.ts';
import type { IntentVerifier } from './verify.ts';

export type Fetch = typeof fetch;
export type Query = Record<string, string | number | boolean | null | undefined>;

export interface RequestOptions {
  query?: Query;
  body?: unknown;
  idempotencyKey?: string;
}

export class HevnApiError extends Error {
  override name = 'HevnApiError';
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;
  readonly requestId: string | null;

  constructor(status: number, body: unknown, requestId: string | null = null) {
    const error = (body as { error?: { code?: string; message?: string; details?: Record<string, unknown> } } | null)?.error ?? {};
    const code = error.code ?? 'internal_error';
    super(`${status} ${code}: ${error.message ?? ''}`.trim());
    this.status = status;
    this.code = code;
    this.details = error.details ?? {};
    this.requestId = requestId;
  }
}

export class Http {
  static readonly MAX_RATE_LIMIT_RETRIES = 5;

  readonly environment: Environment;
  readonly fetch: Fetch;

  constructor(environment: Environment, fetchImpl: Fetch = fetch) {
    this.environment = environment;
    this.fetch = fetchImpl;
  }

  url(path: string, query?: Query): URL {
    const url = new URL(this.environment.apiUrl + (path.startsWith('/') ? path : `/${path}`));
    for (const [name, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null) url.searchParams.set(name, String(value));
    }
    return url;
  }

  async send(method: string, path: string, headers: Record<string, string>, options: RequestOptions = {}): Promise<Response> {
    const hasBody = options.body !== undefined;
    const all: Record<string, string> = { accept: 'application/json', ...headers, ...(hasBody ? { 'content-type': 'application/json' } : {}) };
    if (options.idempotencyKey) all['idempotency-key'] = options.idempotencyKey;
    for (let attempt = 0; ; attempt += 1) {
      const response = await this.fetch(this.url(path, options.query), {
        method,
        headers: all,
        body: hasBody ? JSON.stringify(options.body) : undefined,
      });
      if (response.status !== 429 || attempt >= Http.MAX_RATE_LIMIT_RETRIES) return response;
      await sleep(Http.retryAfter(response));
    }
  }

  async json<T>(response: Response): Promise<T> {
    const text = await response.text();
    let body: unknown = {};
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = { error: { code: 'internal_error', message: text.slice(0, 200) } };
      }
    }
    if (!response.ok) throw new HevnApiError(response.status, body, response.headers.get('x-request-id'));
    return body as T;
  }

  async post<T>(path: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
    return this.json<T>(await this.send('POST', path, headers, { body }));
  }

  static retryAfter(response: Response): number {
    const seconds = Number(response.headers.get('retry-after'));
    return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 1000;
  }
}

export interface SessionOptions {
  http: Http;
  key: DeveloperKey;
  email: string;
  verifier: IntentVerifier;
  refreshToken?: string;
  now?: () => number;
}

export class Session {
  static readonly REMINT_BEFORE_MS = 60_000;
  static readonly PROOF_TTL_MS = 120_000;

  readonly email: string;
  #tokens: Partial<Tokens> = {};
  #expiresAt = 0;
  #pending: Promise<string> | null = null;
  readonly #http: Http;
  readonly #key: DeveloperKey;
  readonly #verifier: IntentVerifier;
  readonly #now: () => number;

  constructor(options: SessionOptions) {
    this.#http = options.http;
    this.#key = options.key;
    this.#verifier = options.verifier;
    this.#now = options.now ?? Date.now;
    this.email = Session.normalizeEmail(options.email);
    if (options.refreshToken) this.#tokens.refreshToken = options.refreshToken;
  }

  static normalizeEmail(email: string): string {
    const trimmed = email.trim().normalize('NFC');
    const at = trimmed.lastIndexOf('@');
    if (at <= 0) throw new TypeError(`${email} is not an email address`);
    return `${trimmed.slice(0, at)}@${trimmed.slice(at + 1).toLowerCase()}`;
  }

  get userId(): ClientId | undefined {
    return this.#tokens.userId;
  }

  get refreshToken(): string | undefined {
    return this.#tokens.refreshToken;
  }

  token(force = false): Promise<string> {
    if (!force && this.#tokens.accessToken && this.#now() < this.#expiresAt - Session.REMINT_BEFORE_MS) {
      return Promise.resolve(this.#tokens.accessToken);
    }
    this.#pending ??= this.mint().finally(() => {
      this.#pending = null;
    });
    return this.#pending;
  }

  async login(): Promise<Tokens> {
    const nonce = randomInt(1, 2 ** 48 - 1);
    const requestExpiry = this.#now() + Session.PROOF_TTL_MS;
    const proof = Buffer.from(`hevn-developer-key-login:${this.email}:${nonce}:${requestExpiry}`, 'utf8');
    const challenge = await this.#http.post<LoginChallenge>('/auth/challenge', {
      email: this.email,
      publicKey: this.#key.publicKey,
      nonce,
      requestExpiry,
      signature: this.#key.signBytes(proof),
    });
    const decoded = this.#verifier.login(challenge, { email: this.email, nonce, requestExpiry });
    const tokens = await this.#http.post<Tokens>('/auth/token', {
      challengeId: challenge.challengeId,
      signature: this.#key.signBytes(decoded.bytes),
      publicKey: this.#key.publicKey,
    });
    this.store(tokens);
    return tokens;
  }

  async refresh(): Promise<Tokens> {
    const refreshToken = this.#tokens.refreshToken;
    if (!refreshToken) return this.login();
    const minted = await this.#http.post<Omit<Tokens, 'refreshToken'> & { refreshToken?: string }>(
      '/auth/refresh',
      {},
      { authorization: `Bearer ${refreshToken}` },
    );
    const tokens = { ...minted, refreshToken: minted.refreshToken ?? refreshToken };
    this.store(tokens);
    return tokens;
  }

  private async mint(): Promise<string> {
    if (!this.#tokens.refreshToken) return (await this.login()).accessToken;
    try {
      return (await this.refresh()).accessToken;
    } catch (error) {
      if (!(error instanceof HevnApiError) || (error.status !== 401 && error.status !== 403)) throw error;
      this.#tokens = {};
      return (await this.login()).accessToken;
    }
  }

  private store(tokens: Tokens): void {
    this.#tokens = { ...tokens };
    this.#expiresAt = this.#now() + tokens.expiresIn * 1000;
  }
}

export interface PollOptions {
  deadlineMs?: number;
  firstMs?: number;
  capMs?: number;
}

export async function pollUntil<T>(read: () => Promise<T>, done: (value: T) => boolean, options: PollOptions = {}): Promise<T> {
  const { deadlineMs = 120_000, firstMs = 1_000, capMs = 8_000 } = options;
  const until = Date.now() + deadlineMs;
  let delay = firstMs;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > until) throw new Error(`Polling did not finish within ${deadlineMs}ms`);
    await sleep(delay + Math.random() * (delay / 2));
    delay = Math.min(delay * 2, capMs);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((wake) => setTimeout(wake, ms));
}

export async function saveTo(response: Response, into: string): Promise<string> {
  await writeFile(into, Buffer.from(await response.arrayBuffer()));
  return into;
}

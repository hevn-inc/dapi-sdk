import { randomUUID } from 'node:crypto';

import { HexCheck } from './encoding.ts';
import { APPROVAL_WINDOW_MS, resolveEnvironment, type Environment, type EnvironmentName } from './environment.ts';
import { Http, HevnApiError, pollUntil, saveTo, Session, sleep, type Fetch, type PollOptions, type Query, type RequestOptions } from './http.ts';
import type {
  Client,
  ClientId,
  CoSignable,
  CoSignExpectation,
  EscrowActionInput,
  EscrowActionResult,
  EscrowCreateInput,
  EscrowDeal,
  ExpectedIntent,
  Hex as HexString,
  MoneyAmount,
  Page,
  Payout,
  PayoutCreateInput,
  Receipt,
  Swap,
  SwapCreateInput,
  Tokens,
} from './intents.ts';
import type { DeveloperKey } from './key.ts';
import { IntentRefused } from './payload.ts';
import { IntentVerifier } from './verify.ts';

export interface HevnOptions {
  key: DeveloperKey;
  email: string;
  environment?: EnvironmentName | Environment;
  fetch?: Fetch;
  refreshToken?: string;
  now?: () => number;
}

export type FlowExpectation = Omit<CoSignExpectation, 'intent'> & { intent?: ExpectedIntent | 'client' };

export interface FlowOptions {
  idempotencyKey?: string;
  reopenAttempts?: number;
  deadlineMs?: number;
}

export interface Settlement<Prepared> {
  prepared: Prepared;
  receipt: Receipt;
}

export class ReopenRequired extends Error {
  override name = 'ReopenRequired';
}

export class Hevn {
  static readonly CONFIRM_AGAIN = new Set(['funding_in_progress', 'bundler_rejected', 'bundler_unavailable']);
  static readonly REOPEN = new Set(['funding_attempt_expired']);

  readonly clientId: ClientId | null;
  readonly http: Http;
  readonly session: Session;
  readonly key: DeveloperKey;
  readonly verifier: IntentVerifier;

  readonly payouts: Payouts;
  readonly swaps: Swaps;
  readonly escrow: Escrow;
  readonly clients: Clients;
  readonly contacts: Contacts;
  readonly banks: Banks;
  readonly payins: Payins;
  readonly transactions: Transactions;
  readonly documents: Documents;
  readonly sandbox: Sandbox;

  constructor(parts: { http: Http; session: Session; key: DeveloperKey; verifier: IntentVerifier }, clientId: ClientId | null = null) {
    this.http = parts.http;
    this.session = parts.session;
    this.key = parts.key;
    this.verifier = parts.verifier;
    this.clientId = clientId;
    this.payouts = new Payouts(this);
    this.swaps = new Swaps(this);
    this.escrow = new Escrow(this);
    this.clients = new Clients(this);
    this.contacts = new Contacts(this);
    this.banks = new Banks(this);
    this.payins = new Payins(this);
    this.transactions = new Transactions(this);
    this.documents = new Documents(this);
    this.sandbox = new Sandbox(this);
  }

  static connect(options: HevnOptions): Hevn {
    const environment = resolveEnvironment(options.environment ?? Hevn.environmentFromEnv());
    const http = new Http(environment, options.fetch);
    const verifier = new IntentVerifier({ environment, now: options.now });
    const session = new Session({ http, key: options.key, email: options.email, verifier, refreshToken: options.refreshToken, now: options.now });
    return new Hevn({ http, session, key: options.key, verifier });
  }

  static environmentFromEnv(): EnvironmentName {
    return process.env.HEVN_ENV === 'production' ? 'production' : 'sandbox';
  }

  get environment(): Environment {
    return this.http.environment;
  }

  actingAs(clientId: ClientId | string): Hevn {
    if (!/^cl_[A-Za-z0-9]+$/.test(clientId)) throw new TypeError(`${clientId} is not a cl_… client id`);
    return new Hevn(this, clientId as ClientId);
  }

  async me(): Promise<Hevn> {
    if (!this.session.userId) await this.session.token();
    return this.actingAs(this.session.userId as ClientId);
  }

  login(): Promise<Tokens> {
    return this.session.login();
  }

  get<T>(path: string, query?: Query): Promise<T> {
    return this.call<T>('GET', path, { query });
  }

  post<T>(path: string, body: unknown = {}, options: Omit<RequestOptions, 'body'> = {}): Promise<T> {
    return this.call<T>('POST', path, { ...options, body });
  }

  put<T>(path: string, body: unknown, options: Omit<RequestOptions, 'body'> = {}): Promise<T> {
    return this.call<T>('PUT', path, { ...options, body });
  }

  patch<T>(path: string, body: unknown): Promise<T> {
    return this.call<T>('PATCH', path, { body });
  }

  delete<T>(path: string): Promise<T> {
    return this.call<T>('DELETE', path);
  }

  async call<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    return this.http.json<T>(await this.send(method, path, options));
  }

  async download(path: string, query: Query, into: string): Promise<string> {
    const response = await this.send('GET', path, { query });
    if (!response.ok) await this.http.json(response);
    return saveTo(response, into);
  }

  async smartWallet(): Promise<HexString> {
    const scoped = this.clientId ? this : await this.me();
    const client = await scoped.get<Client>('/client');
    if (!HexCheck.isAddress(client.baseSmartWallet)) {
      throw new IntentRefused('intent_mismatch', `Client ${client.id} has no Base smart wallet yet.`);
    }
    return client.baseSmartWallet;
  }

  async expectation(expect: FlowExpectation): Promise<CoSignExpectation> {
    if (expect.intent !== 'client') return expect as CoSignExpectation;
    return { ...expect, intent: { smartWallet: await this.smartWallet() } };
  }

  async confirmUntilSettled(path: string, signature: string, options: { deadlineMs?: number } = {}): Promise<Receipt> {
    const until = Date.now() + (options.deadlineMs ?? 180_000);
    let delay = 1_000;
    for (;;) {
      let reason = 'submitted';
      try {
        const receipt = await this.post<Receipt>(path, { signature, publicKey: this.key.publicKey });
        if (receipt.status !== 'submitted') return receipt;
      } catch (error) {
        if (!(error instanceof HevnApiError)) {
          reason = (error as Error).message;
        } else if (error.code === 'already_funded') {
          return { id: '', status: 'settled', transactionHash: (error.details.transactionHash as string) ?? null };
        } else if (Hevn.REOPEN.has(error.code)) {
          throw new ReopenRequired(path);
        } else if (Hevn.CONFIRM_AGAIN.has(error.code)) {
          reason = error.code;
        } else {
          throw error;
        }
      }
      if (Date.now() > until) throw new Error(`${path} still ${reason}`);
      await sleep(delay);
      delay = Math.min(delay * 2, 8_000);
    }
  }

  async coSign<Prepared extends CoSignable>(
    open: (idempotencyKey: string) => Promise<Prepared>,
    confirmPath: (prepared: Prepared) => string,
    expect: FlowExpectation,
    windowMs: number,
    options: FlowOptions,
  ): Promise<Settlement<Prepared>> {
    const idempotencyKey = options.idempotencyKey ?? randomUUID();
    const expected = await this.expectation(expect);
    for (let attempt = 0; ; attempt += 1) {
      const prepared = await open(idempotencyKey);
      if (prepared.approval == null && (prepared as { status?: string }).status !== 'awaitingSignature') {
        return { prepared, receipt: { id: prepared.id, status: (prepared as unknown as Receipt).status } };
      }
      const decoded = this.verifier.coSign(prepared, expected, windowMs);
      const signature = this.key.signBytes(decoded.bytes);
      try {
        const receipt = await this.confirmUntilSettled(confirmPath(prepared), signature, options);
        if (receipt.status !== 'failed' || attempt >= (options.reopenAttempts ?? 2)) return { prepared, receipt: { ...receipt, id: receipt.id || prepared.id } };
      } catch (error) {
        if (!(error instanceof ReopenRequired) || attempt >= (options.reopenAttempts ?? 2)) throw error;
      }
    }
  }

  private async send(method: string, path: string, options: RequestOptions): Promise<Response> {
    for (let retried = false; ; retried = true) {
      const headers: Record<string, string> = { authorization: `Bearer ${await this.session.token(retried)}` };
      if (this.clientId) headers['x-hevn-account'] = this.clientId;
      const response = await this.http.send(method, path, headers, options);
      if (response.status !== 401 || retried) return response;
    }
  }
}

export class Clients {
  readonly hevn: Hevn;

  constructor(hevn: Hevn) {
    this.hevn = hevn;
  }

  create<T = Client>(body: Record<string, unknown>, options: { idempotencyKey?: string } = {}): Promise<T> {
    return this.hevn.post<T>('/clients', body, options);
  }

  list<T = Client>(query?: Query): Promise<Page<T>> {
    return this.hevn.get<Page<T>>('/clients', query);
  }

  current<T = Client>(): Promise<T> {
    return this.hevn.get<T>('/client');
  }

  update<T = Client>(body: Record<string, unknown>): Promise<T> {
    return this.hevn.patch<T>('/client', body);
  }

  balance<T = unknown>(): Promise<T> {
    return this.hevn.get<T>('/client/balance');
  }

  kyb<T = unknown>(): Promise<T> {
    return this.hevn.get<T>('/client/kyb');
  }

  submitKyb<T = unknown>(body: Record<string, unknown>, options: { idempotencyKey?: string } = {}): Promise<T> {
    return this.hevn.put<T>('/client/kyb', body, options);
  }

  completeKyb<T = unknown>(): Promise<T> {
    return this.hevn.post<T>('/client/kyb/complete');
  }
}

export class Payouts {
  readonly hevn: Hevn;

  constructor(hevn: Hevn) {
    this.hevn = hevn;
  }

  create(input: PayoutCreateInput, options: { idempotencyKey: string }): Promise<Payout> {
    return this.hevn.post<Payout>('/payouts', { ...input, publicKey: this.hevn.key.publicKey }, options);
  }

  preview<T = unknown>(rail: string, amount: MoneyAmount): Promise<T> {
    return this.hevn.post<T>('/payouts/preview', { rail, amount });
  }

  get<T = Payout>(payoutId: string): Promise<T> {
    return this.hevn.get<T>(`/payouts/${encodeURIComponent(payoutId)}`);
  }

  confirm(payoutId: string, signature: string): Promise<Receipt> {
    return this.hevn.post<Receipt>(`/payouts/${encodeURIComponent(payoutId)}/confirm`, { signature, publicKey: this.hevn.key.publicKey });
  }

  verify(payout: Payout, expect: CoSignExpectation) {
    return this.hevn.verifier.coSign(payout, expect, APPROVAL_WINDOW_MS.payout);
  }

  send(input: PayoutCreateInput, expect: FlowExpectation, options: FlowOptions = {}): Promise<Settlement<Payout>> {
    return this.hevn.coSign(
      (idempotencyKey) => this.create(input, { idempotencyKey }),
      (payout) => `/payouts/${encodeURIComponent(payout.id)}/confirm`,
      expect,
      APPROVAL_WINDOW_MS.payout,
      options,
    );
  }
}

export class Swaps {
  readonly hevn: Hevn;

  constructor(hevn: Hevn) {
    this.hevn = hevn;
  }

  preview<T = unknown>(input: SwapCreateInput): Promise<T> {
    return this.hevn.post<T>('/swaps/preview', input);
  }

  create(input: SwapCreateInput, options: { idempotencyKey: string }): Promise<Swap> {
    return this.hevn.post<Swap>('/swaps', { ...input, publicKey: this.hevn.key.publicKey }, options);
  }

  get<T = Swap>(swapId: string): Promise<T> {
    return this.hevn.get<T>(`/swaps/${encodeURIComponent(swapId)}`);
  }

  confirm(swapId: string, signature: string): Promise<Receipt> {
    return this.hevn.post<Receipt>(`/swaps/${encodeURIComponent(swapId)}/confirm`, { signature, publicKey: this.hevn.key.publicKey });
  }

  verify(swap: Swap, expect: CoSignExpectation) {
    return this.hevn.verifier.coSign(swap, expect, APPROVAL_WINDOW_MS.swap);
  }

  send(input: SwapCreateInput, expect: FlowExpectation, options: FlowOptions = {}): Promise<Settlement<Swap>> {
    return this.hevn.coSign(
      (idempotencyKey) => this.create(input, { idempotencyKey }),
      (swap) => `/swaps/${encodeURIComponent(swap.id)}/confirm`,
      expect,
      APPROVAL_WINDOW_MS.swap,
      options,
    );
  }
}

export class Escrow {
  static readonly PENDING = new Set(['signing', 'submitted']);
  static readonly REPREPARE = new Set(['approval_expired', 'approval_consumed']);

  readonly hevn: Hevn;

  constructor(hevn: Hevn) {
    this.hevn = hevn;
  }

  create(input: EscrowCreateInput, options: { idempotencyKey: string }): Promise<EscrowDeal> {
    return this.unbound().post<EscrowDeal>('/escrow', input, options);
  }

  list(query?: Query): Promise<Page<EscrowDeal>> {
    return this.unbound().get<Page<EscrowDeal>>('/escrow', query);
  }

  get(escrowId: string): Promise<EscrowDeal> {
    return this.unbound().get<EscrowDeal>(`/escrow/${encodeURIComponent(escrowId)}`);
  }

  sync(escrowId: string): Promise<EscrowDeal> {
    return this.unbound().post<EscrowDeal>(`/escrow/${encodeURIComponent(escrowId)}/sync`);
  }

  prepare(escrowId: string, input: EscrowActionInput, options: { idempotencyKey: string }): Promise<EscrowActionResult> {
    return this.unbound().post<EscrowActionResult>(`/escrow/${encodeURIComponent(escrowId)}/actions`, input, options);
  }

  confirm(escrowId: string, idempotencyKey: string, signature: string): Promise<EscrowActionResult> {
    return this.unbound().post<EscrowActionResult>(
      `/escrow/${encodeURIComponent(escrowId)}/actions/${encodeURIComponent(idempotencyKey)}/confirm`,
      { signature, publicKey: this.hevn.key.publicKey },
    );
  }

  async open(input: EscrowCreateInput, options: FlowOptions & { poll?: PollOptions } = {}): Promise<EscrowActionResult> {
    const key = options.idempotencyKey ?? randomUUID();
    return this.drive(
      async () => {
        const deal = await this.create(input, { idempotencyKey: key });
        if (!deal.action) throw new IntentRefused('escrow_mismatch', 'The new escrow carries no approve action.');
        return { deal, action: deal.action, events: [] };
      },
      { action: 'approve' },
      options,
    );
  }

  async run(escrowId: string, input: EscrowActionInput, options: FlowOptions & { poll?: PollOptions } = {}): Promise<EscrowActionResult> {
    const idempotencyKey = options.idempotencyKey ?? randomUUID();
    return this.drive(
      () => this.prepare(escrowId, input, { idempotencyKey }),
      { action: input.action, amount: input.amount, feeBps: input.feeBps, idempotencyKey },
      options,
    );
  }

  private async drive(
    prepare: () => Promise<EscrowActionResult>,
    expected: Parameters<IntentVerifier['escrow']>[1],
    options: FlowOptions & { poll?: PollOptions },
  ): Promise<EscrowActionResult> {
    for (let attempt = 0; ; attempt += 1) {
      const prepared = await prepare();
      if (prepared.action.status !== 'awaitingSignature') return this.settle(prepared, options.poll);
      const decoded = this.hevn.verifier.escrow(prepared, expected);
      const signature = this.hevn.key.signBytes(decoded.bytes);
      try {
        const result = await this.confirmWithBackoff(prepared.deal.id, prepared.action.idempotencyKey, signature, options.deadlineMs);
        return this.settle(result, options.poll);
      } catch (error) {
        const again = error instanceof HevnApiError && Escrow.REPREPARE.has(error.code);
        if (!again || attempt >= (options.reopenAttempts ?? 2)) throw error;
      }
    }
  }

  private async confirmWithBackoff(escrowId: string, idempotencyKey: string, signature: string, deadlineMs = 180_000): Promise<EscrowActionResult> {
    const until = Date.now() + deadlineMs;
    let delay = 1_000;
    for (;;) {
      try {
        return await this.confirm(escrowId, idempotencyKey, signature);
      } catch (error) {
        const transient = !(error instanceof HevnApiError) || Hevn.CONFIRM_AGAIN.has(error.code);
        if (!transient || Date.now() > until) throw error;
      }
      await sleep(delay);
      delay = Math.min(delay * 2, 8_000);
    }
  }

  private async settle(result: EscrowActionResult, poll: PollOptions = {}): Promise<EscrowActionResult> {
    if (!Escrow.PENDING.has(result.action.status)) return result;
    const deal = await pollUntil(
      () => this.sync(result.deal.id),
      (synced) => !Escrow.PENDING.has(synced.action?.status ?? ''),
      { firstMs: 15_000, ...poll },
    );
    return { ...result, deal, action: deal.action ?? result.action };
  }

  private unbound(): Hevn {
    return this.hevn.clientId ? new Hevn(this.hevn) : this.hevn;
  }
}

export class Contacts {
  readonly hevn: Hevn;

  constructor(hevn: Hevn) {
    this.hevn = hevn;
  }

  create<T = unknown>(body: Record<string, unknown>, options: { idempotencyKey?: string } = {}): Promise<T> {
    return this.hevn.post<T>('/contacts', body, options);
  }

  list<T = unknown>(query?: Query): Promise<Page<T>> {
    return this.hevn.get<Page<T>>('/contacts', query);
  }

  get<T = unknown>(contactId: string): Promise<T> {
    return this.hevn.get<T>(`/contacts/${encodeURIComponent(contactId)}`);
  }

  update<T = unknown>(contactId: string, body: Record<string, unknown>): Promise<T> {
    return this.hevn.patch<T>(`/contacts/${encodeURIComponent(contactId)}`, body);
  }

  remove<T = unknown>(contactId: string): Promise<T> {
    return this.hevn.delete<T>(`/contacts/${encodeURIComponent(contactId)}`);
  }

  capabilities<T = unknown>(contactId: string): Promise<T> {
    return this.hevn.get<T>(`/contacts/${encodeURIComponent(contactId)}/capabilities`);
  }
}

export class Banks {
  readonly hevn: Hevn;

  constructor(hevn: Hevn) {
    this.hevn = hevn;
  }

  list<T = unknown>(query?: Query): Promise<T> {
    return this.hevn.get<T>('/banks', query);
  }

  open<T = unknown>(body: Record<string, unknown>, options: { idempotencyKey?: string } = {}): Promise<T> {
    return this.hevn.post<T>('/banks', body, options);
  }

  get<T = unknown>(rail: string): Promise<T> {
    return this.hevn.get<T>(`/banks/${encodeURIComponent(rail)}`);
  }

  requirements<T = unknown>(rail: string): Promise<T> {
    return this.hevn.get<T>(`/banks/${encodeURIComponent(rail)}/requirements`);
  }

  rate<T = unknown>(rail: string, query?: Query): Promise<T> {
    return this.hevn.get<T>(`/banks/${encodeURIComponent(rail)}/rate`, query);
  }
}

export class Payins {
  readonly hevn: Hevn;

  constructor(hevn: Hevn) {
    this.hevn = hevn;
  }

  create<T = unknown>(body: Record<string, unknown>, options: { idempotencyKey?: string } = {}): Promise<T> {
    return this.hevn.post<T>('/payins', body, options);
  }

  instructions<T = unknown>(payinId: string, body: Record<string, unknown> = {}): Promise<T> {
    return this.hevn.post<T>(`/payins/${encodeURIComponent(payinId)}/instructions`, body);
  }

  get<T = unknown>(payinId: string): Promise<T> {
    return this.hevn.get<T>(`/payins/${encodeURIComponent(payinId)}`);
  }
}

export class Transactions {
  readonly hevn: Hevn;

  constructor(hevn: Hevn) {
    this.hevn = hevn;
  }

  list<T = unknown>(query?: Query): Promise<Page<T>> {
    return this.hevn.get<Page<T>>('/transactions', query);
  }

  summary<T = unknown>(query?: Query): Promise<T> {
    return this.hevn.get<T>('/transactions/summary', query);
  }

  get<T = unknown>(transactionId: string): Promise<T> {
    return this.hevn.get<T>(`/transactions/${encodeURIComponent(transactionId)}`);
  }

  sync<T = unknown>(): Promise<T> {
    return this.hevn.post<T>('/transactions/sync');
  }

  export(query: Query, into: string): Promise<string> {
    return this.hevn.download('/transactions/export', query, into);
  }
}

export class Documents {
  readonly hevn: Hevn;

  constructor(hevn: Hevn) {
    this.hevn = hevn;
  }

  upload<T = unknown>(body: Record<string, unknown>, options: { idempotencyKey?: string } = {}): Promise<T> {
    return this.hevn.post<T>('/documents', body, options);
  }

  content<T = unknown>(documentId: string, body: Record<string, unknown>, options: { idempotencyKey?: string } = {}): Promise<T> {
    return this.hevn.put<T>(`/documents/${encodeURIComponent(documentId)}/content`, body, options);
  }
}

export class Sandbox {
  readonly hevn: Hevn;

  constructor(hevn: Hevn) {
    this.hevn = hevn;
  }

  treasury<T = unknown>(): Promise<T> {
    return this.hevn.get<T>('/sandbox/treasury');
  }

  deposit<T = unknown>(body: Record<string, unknown>): Promise<T> {
    return this.hevn.post<T>('/sandbox/deposits', body);
  }

  completePayin<T = unknown>(payinId: string, body: Record<string, unknown> = {}): Promise<T> {
    return this.hevn.post<T>(`/sandbox/payins/${encodeURIComponent(payinId)}/complete`, body);
  }

  payoutStatus<T = unknown>(payoutId: string, body: Record<string, unknown>): Promise<T> {
    return this.hevn.post<T>(`/sandbox/payouts/${encodeURIComponent(payoutId)}/status`, body);
  }
}


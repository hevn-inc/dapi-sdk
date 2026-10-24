import { HevnConnectError } from '@hevn/dapi-sdk/browser';

import type { Call } from '@/app/api/calls';

import type { Balance, CreatedPayout, Kyb, Me, Payout, Rail, RailList, Requirements, TransactionPage } from './types';

export interface LogEntry extends Call {
  source: 'hevn' | 'window';
}

/** What the page shows in its API log: HEVN calls the server made for it, plus notes about the HEVN window. */
export class ApiLog {
  private readonly listeners = new Set<(entries: LogEntry[]) => void>();

  subscribe(listener: (entries: LogEntry[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  record(entries: LogEntry[]): void {
    if (entries.length) for (const listener of this.listeners) listener(entries);
  }

  note(label: string, data: unknown): void {
    this.record([{ source: 'window', method: 'POPUP', path: label, account: null, status: 200, ms: 0, request: null, response: data }]);
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: unknown = null,
  ) {
    super(message);
  }
}

interface Envelope<T> {
  result?: T;
  calls?: Call[];
  code?: string;
  message?: string;
  details?: unknown;
}

/**
 * The page's view of its own backend, `app/api/[...path]/route.ts`.
 * Methods are arrow properties so they can be passed around as-is, for example to `useResource(api.balance)`.
 */
export class DemoApi {
  private static readonly CONNECT_ERRORS: Record<string, string> = {
    access_denied: 'You closed or declined the request in the HEVN window.',
    popup_blocked: 'Your browser blocked the HEVN window. Allow pop-ups for this site and try again.',
    timeout: 'The HEVN window timed out. Try again.',
    already_linked: 'This HEVN account is already connected.',
    invalid_session: 'The sign-in link was not valid. Try again.',
    aborted: 'The request was cancelled.',
  };

  readonly log = new ApiLog();
  private readonly signedOutListeners = new Set<() => void>();

  startSignIn = () => this.post<{ url: string }>('auth/session');
  link = (code: string, state: string | undefined) => this.post<{ signedIn: true }>('auth/link', { code, state });
  signOut = () => this.post<{ signedIn: false }>('auth/logout');

  me = () => this.get<Me>('me');
  balance = () => this.get<Balance>('balance');
  transactions = () => this.get<TransactionPage>('transactions');
  deposit = (amount: string) => this.post<unknown>('deposit', { amount });

  kyb = () => this.get<Kyb>('kyb');
  runKyb = () => this.post<Kyb>('kyb/run');

  banks = () => this.get<RailList>('banks');
  bankRequirements = (rail: string) => this.get<Requirements>(`banks/${encodeURIComponent(rail)}/requirements`);
  openBank = (rail: string) => this.post<Rail>(`banks/${encodeURIComponent(rail)}`);

  sendToWallet = (address: string, amount: string) => this.post<CreatedPayout>('payouts', { address, amount });
  payout = (id: string) => this.get<Payout>(`payouts/${encodeURIComponent(id)}`);

  /** Called whenever the backend answers 401, so the page can drop back to the sign-in screen. */
  onSignedOut(listener: () => void): () => void {
    this.signedOutListeners.add(listener);
    return () => this.signedOutListeners.delete(listener);
  }

  /** A sentence to show the visitor for anything a request or the HEVN window threw. */
  describe(error: unknown): string {
    if (error instanceof HevnConnectError) return DemoApi.CONNECT_ERRORS[error.code] ?? `The HEVN window stopped: ${error.code}.`;
    if (error instanceof ApiError) {
      const message = error.message.replace(/^\d{3} [a-z_]+:\s*/, '');
      return message ? `${message} (${error.code})` : error.code;
    }
    return error instanceof Error ? error.message : String(error);
  }

  private get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  private post<T>(path: string, body?: object): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: object): Promise<T> {
    const response = await fetch(`/api/${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
    const envelope = (await response.json().catch(() => ({}))) as Envelope<T>;
    this.log.record((envelope.calls ?? []).map((call) => ({ ...call, source: 'hevn' })));
    if (response.ok) return envelope.result as T;
    if (response.status === 401) for (const listener of this.signedOutListeners) listener();
    throw new ApiError(response.status, envelope.code ?? 'error', envelope.message ?? `Request failed with ${response.status}`, envelope.details ?? null);
  }
}

export const api = new DemoApi();

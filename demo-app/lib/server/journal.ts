import { AsyncLocalStorage } from 'node:async_hooks';

export interface JournalEntry {
  seq: number;
  at: string;
  source: 'server' | 'browser';
  method: string;
  path: string;
  account: string | null;
  status: number;
  durationMs: number;
  request: unknown;
  response: unknown;
}

type Draft = Omit<JournalEntry, 'seq' | 'at'>;

interface JournalState {
  seq: number;
  books: Map<string, JournalEntry[]>;
  scope: AsyncLocalStorage<string>;
}

const shared = globalThis as typeof globalThis & { __neobankJournal?: JournalState };

export class Journal {
  static readonly SIZE = 150;
  static readonly BOOKS = 500;
  static readonly HIDDEN =
    /^(accesstoken|refreshtoken|idtoken|token|tokens|signature|signatures|content|privatekey|pem|secret|password|authorization|session|cookie)$/i;
  static readonly LONG_CODE = /^(code|state)$/;

  static get state(): JournalState {
    shared.__neobankJournal ??= { seq: 0, books: new Map(), scope: new AsyncLocalStorage<string>() };
    return shared.__neobankJournal;
  }

  static run<T>(sid: string, work: () => Promise<T>): Promise<T> {
    return Journal.state.scope.run(sid, work);
  }

  static add(sid: string, draft: Draft): void {
    const state = Journal.state;
    state.seq += 1;
    const book = state.books.get(sid) ?? [];
    book.push({ seq: state.seq, at: new Date().toISOString(), ...draft });
    if (book.length > Journal.SIZE) book.splice(0, book.length - Journal.SIZE);
    state.books.delete(sid);
    state.books.set(sid, book);
    while (state.books.size > Journal.BOOKS) {
      const oldest = state.books.keys().next().value;
      if (oldest === undefined) break;
      state.books.delete(oldest);
    }
  }

  static after(sid: string, seq: number): JournalEntry[] {
    return (Journal.state.books.get(sid) ?? []).filter((entry) => entry.seq > seq);
  }

  static clear(sid: string): void {
    Journal.state.books.delete(sid);
  }

  static fetch: typeof fetch = async (input, init) => {
    const sid = Journal.state.scope.getStore();
    if (!sid) return fetch(input, init);
    const started = performance.now();
    const url = new URL(input instanceof Request ? input.url : String(input));
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const base = {
      source: 'server' as const,
      method: init?.method ?? (input instanceof Request ? input.method : 'GET'),
      path: url.pathname + url.search,
      account: headers.get('x-hevn-account'),
      request: Journal.parse(init?.body),
    };
    try {
      const response = await fetch(input, init);
      const text = await response.clone().text();
      Journal.add(sid, { ...base, status: response.status, durationMs: Math.round(performance.now() - started), response: Journal.parse(text) });
      return response;
    } catch (error) {
      Journal.add(sid, { ...base, status: 0, durationMs: Math.round(performance.now() - started), response: { error: String(error) } });
      throw error;
    }
  };

  static parse(body: unknown): unknown {
    if (typeof body !== 'string' || !body) return null;
    try {
      return Journal.redact(JSON.parse(body));
    } catch {
      return body.length > 300 ? `[${body.length} characters]` : body;
    }
  }

  static redact(value: unknown, key = ''): unknown {
    if (typeof value === 'string') {
      if (Journal.HIDDEN.test(key)) return `[${value.length} characters hidden]`;
      if (Journal.LONG_CODE.test(key) && value.length > 24) return `${value.slice(0, 6)}… [hidden]`;
      if (value.includes('session=')) return value.replace(/session=[^&\s]+/g, 'session=[hidden]');
      return value.length > 2000 ? `[${value.length} characters]` : value;
    }
    if (Array.isArray(value)) return value.map((item) => Journal.redact(item, Journal.HIDDEN.test(key) ? key : ''));
    if (value && typeof value === 'object') {
      if (Journal.HIDDEN.test(key)) return '[hidden]';
      return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, Journal.redact(item, name)]));
    }
    return value;
  }
}

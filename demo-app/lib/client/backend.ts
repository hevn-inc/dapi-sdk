import { HevnConnectError } from '@hevn/dapi-sdk/browser';

export class BackendError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details: unknown = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class Backend {
  static readonly SIGNED_OUT = 'neobank:signed-out';

  static async call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const method = init.method ?? (init.body === undefined ? 'GET' : 'POST');
    const response = await fetch(path, {
      method,
      headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: 'no-store',
      credentials: 'same-origin',
    });
    const json = (await response.json().catch(() => ({}))) as { code?: string; message?: string; details?: unknown };
    if (!response.ok) {
      if (response.status === 401) window.dispatchEvent(new Event(Backend.SIGNED_OUT));
      throw new BackendError(response.status, json.code ?? 'error', json.message ?? `Request failed with ${response.status}`, json.details ?? null);
    }
    return json as T;
  }

  static get<T>(path: string): Promise<T> {
    return Backend.call<T>(path);
  }

  static post<T>(path: string, body: unknown = {}): Promise<T> {
    return Backend.call<T>(path, { method: 'POST', body });
  }

  static note(label: string, data: unknown): void {
    Backend.post('/api/log', { label, data }).catch(() => undefined);
  }

  static describe(error: unknown): string {
    if (error instanceof HevnConnectError) return Backend.CONNECT[error.code] ?? `The HEVN window stopped: ${error.code}.`;
    if (error instanceof BackendError) {
      const message = error.message.replace(/^\d{3} [a-z_]+:\s*/, '');
      return message ? `${message} (${error.code})` : error.code;
    }
    return error instanceof Error ? error.message : String(error);
  }

  static readonly CONNECT: Record<string, string> = {
    access_denied: 'You closed or declined the request in the HEVN window.',
    popup_blocked: 'Your browser blocked the HEVN window. Allow pop-ups for this site and try again.',
    timeout: 'The HEVN window timed out. Try again.',
    already_linked: 'This HEVN account is already connected.',
    invalid_session: 'The sign-in link was not valid. Try again.',
    aborted: 'The request was cancelled.',
  };
}

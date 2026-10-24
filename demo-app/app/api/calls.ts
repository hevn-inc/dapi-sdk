import { AsyncLocalStorage } from 'node:async_hooks';

export interface Call {
  method: string;
  path: string;
  account: string | null;
  status: number;
  ms: number;
  request: unknown;
  response: unknown;
}

/** Records the HEVN requests made while serving one browser request, so the page can show them in its API log. */
export class CallLog {
  private static readonly SECRET_FIELDS = /^(accessToken|refreshToken|token|signature|content|state|url)$/;
  private readonly current = new AsyncLocalStorage<Call[]>();

  record<T>(work: () => Promise<T>): Promise<{ result?: T; error?: unknown; calls: Call[] }> {
    const calls: Call[] = [];
    return this.current.run(calls, () =>
      work().then(
        (result) => ({ result, calls }),
        (error: unknown) => ({ error, calls }),
      ),
    );
  }

  /** A `fetch` for the SDK that writes each request into the log of the browser request it serves. */
  readonly fetch: typeof fetch = async (input, init) => {
    const calls = this.current.getStore();
    const started = performance.now();
    const response = await fetch(input, init);
    if (calls) {
      const url = new URL(input instanceof Request ? input.url : String(input));
      calls.push({
        method: init?.method ?? 'GET',
        path: url.pathname.replace(/^\/dapi\/v1/, '') + url.search,
        account: new Headers(init?.headers).get('x-hevn-account'),
        status: response.status,
        ms: Math.round(performance.now() - started),
        request: CallLog.hide(CallLog.parse(init?.body)),
        response: CallLog.hide(CallLog.parse(await response.clone().text())),
      });
    }
    return response;
  };

  private static parse(body: unknown): unknown {
    if (typeof body !== 'string' || !body) return null;
    try {
      return JSON.parse(body);
    } catch {
      return body.length > 200 ? `[${body.length} characters]` : body;
    }
  }

  private static hide(value: unknown, key = ''): unknown {
    if (typeof value === 'string' && (CallLog.SECRET_FIELDS.test(key) || (key === 'code' && value.length > 40))) return '[hidden]';
    if (Array.isArray(value)) return value.map((item) => CallLog.hide(item));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, CallLog.hide(item, name)]));
    return value;
  }
}

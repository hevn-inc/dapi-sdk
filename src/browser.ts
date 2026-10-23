import type { EnvironmentName } from './environment.ts';

export interface HevnConnectOptions {
  environment?: EnvironmentName;
  appUrl?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface LinkResult {
  code: string;
}

export interface SignResult {
  status: string;
  payoutId: string;
  reference: string | null;
}

export class HevnConnectError extends Error {
  override name = 'HevnConnectError';
  readonly code: string;

  constructor(code: string, message = code) {
    super(message);
    this.code = code;
  }
}

export class HevnConnect {
  static readonly CHANNEL = 'hevn-connect';
  static readonly WINDOW = 'hevn-connect';
  static readonly FEATURES = 'popup,width=460,height=720';
  static readonly TIMEOUT_MS = 10 * 60_000;
  static readonly APP_URLS: Readonly<Record<EnvironmentName, string>> = {
    sandbox: 'https://sandbox.gethevn.com',
    production: 'https://app.gethevn.com',
  };

  static open(options: HevnConnectOptions = {}): HevnConnectWindow {
    const popup = window.open('about:blank', HevnConnect.WINDOW, HevnConnect.FEATURES);
    if (!popup) throw new HevnConnectError('popup_blocked', 'The browser blocked the HEVN window. Call open() inside a click handler.');
    return new HevnConnectWindow(popup, options);
  }

  static complete(location: Location = window.location): boolean {
    const params = new URLSearchParams(location.search);
    const state = params.get('state');
    if (!state) return false;
    const channel = new BroadcastChannel(HevnConnect.CHANNEL);
    channel.postMessage({ state, result: Object.fromEntries(params) });
    channel.close();
    window.close();
    return true;
  }
}

export class HevnConnectWindow {
  private readonly popup: Window;
  private readonly options: HevnConnectOptions;
  private readonly appOrigin: string | null;

  constructor(popup: Window, options: HevnConnectOptions) {
    this.popup = popup;
    this.options = options;
    const appUrl = options.appUrl ?? (options.environment ? HevnConnect.APP_URLS[options.environment] : null);
    this.appOrigin = appUrl ? new URL(appUrl).origin : null;
  }

  async link(sessionUrl: string): Promise<LinkResult> {
    const result = await this.run(sessionUrl);
    return { code: HevnConnectWindow.required(result, 'code') };
  }

  async sign(sessionUrl: string): Promise<SignResult> {
    const result = await this.run(sessionUrl);
    return {
      status: HevnConnectWindow.required(result, 'status'),
      payoutId: HevnConnectWindow.required(result, 'payout'),
      reference: result.reference ?? null,
    };
  }

  close(): void {
    this.popup.close();
  }

  run(sessionUrl: string): Promise<Record<string, string>> {
    let url: URL;
    let state: string;
    try {
      url = new URL(sessionUrl);
      state = HevnConnectWindow.nonce(url);
    } catch {
      return Promise.reject(new HevnConnectError('invalid_session', 'The session URL is not a HEVN sign-in session.'));
    }
    if (this.appOrigin && url.origin !== this.appOrigin) {
      return Promise.reject(new HevnConnectError('invalid_session', `The session URL does not point at ${this.appOrigin}.`));
    }
    const channel = new BroadcastChannel(HevnConnect.CHANNEL);
    return new Promise<Record<string, string>>((resolve, reject) => {
      const settle = (done: () => void) => {
        window.clearTimeout(timer);
        this.options.signal?.removeEventListener('abort', aborted);
        channel.close();
        done();
      };
      const aborted = () => settle(() => reject(new HevnConnectError('aborted')));
      const timer = window.setTimeout(() => settle(() => reject(new HevnConnectError('timeout'))), this.options.timeoutMs ?? HevnConnect.TIMEOUT_MS);
      this.options.signal?.addEventListener('abort', aborted, { once: true });
      channel.onmessage = (event: MessageEvent<{ state?: string; result?: Record<string, string> }>) => {
        if (event.data?.state !== state || !event.data.result) return;
        const result = event.data.result;
        settle(() => (result.error ? reject(new HevnConnectError(result.error)) : resolve(result)));
      };
      this.popup.location.href = url.toString();
    });
  }

  private static required(result: Record<string, string>, key: string): string {
    const value = result[key];
    if (!value) throw new HevnConnectError('invalid_response', `The HEVN window answered without ${key}.`);
    return value;
  }

  private static nonce(url: URL): string {
    const token = url.searchParams.get('session') ?? '';
    const body = token.split('.')[1] ?? '';
    const json = atob(
      body
        .replace(/-/g, '+')
        .replace(/_/g, '/')
        .padEnd(Math.ceil(body.length / 4) * 4, '='),
    );
    const nonce = (JSON.parse(json) as { nonce?: unknown }).nonce;
    if (typeof nonce !== 'string' || !nonce) throw new Error('missing nonce');
    return nonce;
  }
}

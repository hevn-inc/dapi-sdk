import { DeveloperKey, Hevn } from '@hevn/dapi-sdk';
import { NextResponse, type NextRequest } from 'next/server';

import { CallLog } from './calls';
import { config } from './config';
import { session, type SignedCookie } from './cookies';

/** An error a handler throws on purpose; the browser gets its status, code and message. */
export class Refusal extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: unknown = null,
  ) {
    super(message);
  }

  /** Whatever a handler threw, as the response the browser should get. */
  static from(error: unknown): Refusal {
    if (error instanceof Refusal) return error;
    if (error instanceof Error && error.name === 'HevnApiError') {
      const { status, code, message, details } = error as Error & { status: number; code: string; details: unknown };
      // A 401 from HEVN means the partner key is wrong, not that this visitor is signed out.
      return new Refusal(status === 401 ? 502 : status, code, message, details);
    }
    console.error(error);
    return new Refusal(500, 'internal_error', 'Something went wrong on the server.');
  }
}

/** One browser request: its body, path params, the cookies to set on the way out and the HEVN client it acts as. */
export class Exchange {
  readonly cookies = new Map<string, string | null>();

  constructor(
    private readonly request: NextRequest,
    readonly body: Record<string, string>,
    readonly params: Record<string, string>,
    private readonly connect: () => Hevn,
  ) {}

  /** The developer's own HEVN session, for calls made as the partner rather than as a client. */
  get partner(): Hevn {
    return this.connect();
  }

  /** The signed-in visitor's HEVN client. Refuses with 401 when nobody is signed in. */
  get client(): Hevn {
    const current = session.read(this.request.cookies);
    if (!current) throw new Refusal(401, 'unauthorized', 'Sign in to continue.');
    return this.partner.actingAs(current.clientId);
  }

  read<T extends object>(cookie: SignedCookie<T>): T | null {
    return cookie.read(this.request.cookies);
  }

  set<T extends object>(cookie: SignedCookie<T>, payload: T | null): void {
    this.cookies.set(cookie.name, payload ? cookie.seal(payload) : null);
  }
}

type Handler = (exchange: Exchange) => Promise<unknown>;

interface Route {
  method: string;
  parts: string[];
  handler: Handler;
}

/**
 * Serves `/api/*` for the page. Each response carries the handler's `result` (or an error) and the HEVN `calls` it made.
 * Patterns are slash-separated, with `:name` segments captured into `exchange.params`.
 */
export class Router {
  private readonly routes: Route[] = [];
  private readonly calls = new CallLog();
  private partnerClient: Hevn | null = null;

  get(pattern: string, handler: Handler): this {
    return this.add('GET', pattern, handler);
  }

  post(pattern: string, handler: Handler): this {
    return this.add('POST', pattern, handler);
  }

  /** The developer's own HEVN session, signed in once with the key from the environment. */
  get partner(): Hevn {
    this.partnerClient ??= Hevn.connect({ key: DeveloperKey.fromEnv(), email: config.email, fetch: this.calls.fetch });
    return this.partnerClient;
  }

  /** The Next.js route handler: export it as both GET and POST. */
  readonly handle = async (request: NextRequest, { params }: { params: Promise<{ path: string[] }> }): Promise<NextResponse> => {
    const { path } = await params;
    const found = this.match(request.method, path);
    const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
    const exchange = new Exchange(request, body, found?.params ?? {}, () => this.partner);

    const { result, error, calls } = await this.calls.record(async () => {
      if (!found) throw new Refusal(404, 'not_found', 'No such route.');
      const origin = request.headers.get('origin');
      if (request.method === 'POST' && origin && origin !== config.origin) throw new Refusal(403, 'cross_site', 'Wrong origin.');
      return found.handler(exchange);
    });

    const response = error === undefined ? NextResponse.json({ result, calls }) : Router.refuse(Refusal.from(error), calls);
    for (const [name, value] of exchange.cookies) {
      response.cookies.set(name, value ?? '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: value ? undefined : 0 });
    }
    return response;
  };

  private add(method: string, pattern: string, handler: Handler): this {
    this.routes.push({ method, parts: pattern.split('/'), handler });
    return this;
  }

  private match(method: string, path: string[]): { handler: Handler; params: Record<string, string> } | null {
    for (const route of this.routes) {
      if (route.method !== method || route.parts.length !== path.length) continue;
      const params: Record<string, string> = {};
      if (route.parts.every((part, index) => (part.startsWith(':') ? (params[part.slice(1)] = path[index]) : part === path[index]))) {
        return { handler: route.handler, params };
      }
    }
    return null;
  }

  private static refuse(refusal: Refusal, calls: unknown[]): NextResponse {
    const { status, code, message, details } = refusal;
    return NextResponse.json({ code, message, details, calls }, { status });
  }
}

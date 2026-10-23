import { HevnApiError, type Hevn } from '@hevn/dapi-sdk';
import { NextResponse, type NextRequest } from 'next/server';

import { Config } from './config';
import { Partner } from './hevn';
import { Journal } from './journal';
import { Sessions, type DemoSession } from './sessions';

export interface RouteContext {
  params: Promise<Record<string, string>>;
}

export interface Authed {
  request: NextRequest;
  session: DemoSession;
  client: Hevn;
  params: Record<string, string>;
}

export class Refusal extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export class Api {
  static readonly AMOUNT = /^\d{1,9}(\.\d{1,6})?$/;

  static json(body: unknown, status = 200): NextResponse {
    return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
  }

  static refuse(status: number, code: string, message: string): NextResponse {
    return Api.json({ code, message }, status);
  }

  static crossSite(request: NextRequest): NextResponse | null {
    if (request.method === 'GET' || request.method === 'HEAD') return null;
    const origin = request.headers.get('origin');
    if (origin && origin !== Config.origin) return Api.refuse(403, 'cross_site_request', 'This request did not come from this site.');
    return null;
  }

  static failure(error: unknown): NextResponse {
    if (error instanceof Refusal) return Api.refuse(error.status, error.code, error.message);
    if (error instanceof HevnApiError || (error instanceof Error && error.name === 'HevnApiError')) {
      const failure = error as HevnApiError;
      const status = failure.status >= 400 && failure.status < 500 && failure.status !== 401 ? failure.status : 502;
      return Api.json({ code: failure.code, message: failure.message, details: failure.details, requestId: failure.requestId }, status);
    }
    console.error('[neobank]', error instanceof Error ? error.message : 'unexpected failure');
    return Api.refuse(500, 'internal_error', 'Something went wrong on the server.');
  }

  static async body(request: NextRequest): Promise<Record<string, unknown>> {
    try {
      const body: unknown = await request.json();
      return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  static text(body: Record<string, unknown>, key: string): string {
    const value = body[key];
    return typeof value === 'string' ? value.trim() : '';
  }

  static amount(value: string, minimum = 0): string {
    if (!Api.AMOUNT.test(value) || Number(value) <= 0) throw new Refusal(400, 'invalid_amount', 'Enter an amount like 12.50.');
    if (Number(value) < minimum) throw new Refusal(400, 'amount_too_small', `The smallest amount is ${minimum.toFixed(2)}.`);
    return value;
  }

  static rail(value: string | undefined): string {
    if (!value || !/^[a-z0-9_-]{1,64}$/i.test(value)) throw new Refusal(400, 'invalid_rail', 'Unknown account type.');
    return value;
  }

  static payoutId(value: string | undefined): string {
    if (!value || !/^[A-Za-z0-9_-]{1,80}$/.test(value)) throw new Refusal(400, 'invalid_payout', 'Unknown transfer.');
    return value;
  }

  static authed(handler: (context: Authed) => Promise<unknown>) {
    return async (request: NextRequest, context: RouteContext): Promise<NextResponse> => {
      const refused = Api.crossSite(request);
      if (refused) return refused;
      const session = Sessions.read(request.cookies);
      if (!session) return Api.refuse(401, 'unauthorized', 'Sign in to continue.');
      const params = await context.params;
      return Journal.run(session.sid, async () => {
        try {
          const result = await handler({ request, session, client: Partner.as(session.clientId), params });
          return result instanceof NextResponse ? result : Api.json(result);
        } catch (error) {
          return Api.failure(error);
        }
      });
    };
  }
}

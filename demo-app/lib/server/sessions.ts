import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import type { NextResponse } from 'next/server';

import { Config } from './config';

export interface DemoSession {
  clientId: string;
  sid: string;
  exp: number;
}

export interface LinkAttempt {
  state: string;
  sid: string;
  exp: number;
}

interface CookieJar {
  get(name: string): { value: string } | undefined;
}

export class SignedCookie {
  static encode(payload: object): string {
    const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    return `${body}.${SignedCookie.mac(body)}`;
  }

  static decode<T extends { exp: number }>(value: string | undefined): T | null {
    if (!value) return null;
    const [body, mac] = value.split('.');
    if (!body || !mac) return null;
    const expected = Buffer.from(SignedCookie.mac(body), 'base64url');
    const given = Buffer.from(mac, 'base64url');
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    try {
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T;
      return typeof payload.exp === 'number' && payload.exp > Date.now() ? payload : null;
    } catch {
      return null;
    }
  }

  static mac(body: string): string {
    return createHmac('sha256', Config.secret).update(body).digest('base64url');
  }
}

export class Sessions {
  static readonly SESSION = 'neobank_session';
  static readonly LINK = 'neobank_link';
  static readonly SESSION_MS = 12 * 60 * 60_000;
  static readonly LINK_MS = 10 * 60_000;
  static readonly CLIENT_ID = /^cl_[A-Za-z0-9]+$/;

  static newSid(): string {
    return randomBytes(16).toString('base64url');
  }

  static read(cookies: CookieJar): DemoSession | null {
    const session = SignedCookie.decode<DemoSession>(cookies.get(Sessions.SESSION)?.value);
    return session && Sessions.CLIENT_ID.test(session.clientId) && typeof session.sid === 'string' ? session : null;
  }

  static readLink(cookies: CookieJar): LinkAttempt | null {
    const attempt = SignedCookie.decode<LinkAttempt>(cookies.get(Sessions.LINK)?.value);
    return attempt && typeof attempt.state === 'string' && typeof attempt.sid === 'string' ? attempt : null;
  }

  static start(response: NextResponse, clientId: string, sid: string): void {
    const session: DemoSession = { clientId, sid, exp: Date.now() + Sessions.SESSION_MS };
    response.cookies.set(Sessions.SESSION, SignedCookie.encode(session), {
      httpOnly: true,
      secure: Config.secure,
      sameSite: 'lax',
      path: '/',
      maxAge: Sessions.SESSION_MS / 1000,
    });
  }

  static end(response: NextResponse): void {
    response.cookies.set(Sessions.SESSION, '', { httpOnly: true, secure: Config.secure, sameSite: 'lax', path: '/', maxAge: 0 });
  }

  static remember(response: NextResponse, state: string, sid: string): void {
    const attempt: LinkAttempt = { state, sid, exp: Date.now() + Sessions.LINK_MS };
    response.cookies.set(Sessions.LINK, SignedCookie.encode(attempt), {
      httpOnly: true,
      secure: Config.secure,
      sameSite: 'lax',
      path: '/api/auth',
      maxAge: Sessions.LINK_MS / 1000,
    });
  }

  static forget(response: NextResponse): void {
    response.cookies.set(Sessions.LINK, '', { httpOnly: true, secure: Config.secure, sameSite: 'lax', path: '/api/auth', maxAge: 0 });
  }

  static sameState(expected: string, given: unknown): boolean {
    if (typeof given !== 'string' || !given) return false;
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(given, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  }
}

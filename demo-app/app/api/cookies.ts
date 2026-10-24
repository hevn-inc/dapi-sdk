import { createHmac, timingSafeEqual } from 'node:crypto';

import { config } from './config';

const MINUTE = 60_000;

/** `request.cookies` and `cookies()` from next/headers both look like this. */
interface CookieReader {
  get(name: string): { value: string } | undefined;
}

/** A cookie holding a small JSON payload, signed with the session secret and valid for `ttlMs`. */
export class SignedCookie<T extends object> {
  constructor(
    readonly name: string,
    private readonly ttlMs: number,
  ) {}

  seal(payload: T): string {
    const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + this.ttlMs })).toString('base64url');
    return `${body}.${SignedCookie.mac(body)}`;
  }

  read(cookies: CookieReader): T | null {
    const [body, given] = (cookies.get(this.name)?.value ?? '').split('.');
    if (!body || !given) return null;
    const expected = Buffer.from(SignedCookie.mac(body));
    if (expected.length !== given.length || !timingSafeEqual(expected, Buffer.from(given))) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as T & { exp: number };
    return payload.exp > Date.now() ? payload : null;
  }

  private static mac(body: string): string {
    return createHmac('sha256', config.sessionSecret).update(body).digest('base64url');
  }
}

/** Which HEVN client this browser signed in as. */
export const session = new SignedCookie<{ clientId: string }>('acme_session', 12 * 60 * MINUTE);

/** The `state` of a sign-in this browser started, checked when the popup comes back. */
export const pendingLink = new SignedCookie<{ state: string }>('acme_link', 10 * MINUTE);

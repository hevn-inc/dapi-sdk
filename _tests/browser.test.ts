import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { HevnConnect, HevnConnectError } from '../src/browser.ts';

class FakePopup {
  readonly location = { href: 'about:blank' };
  closed = false;

  close(): void {
    this.closed = true;
  }
}

function browser(popup: FakePopup | null) {
  const opened: string[][] = [];
  Object.assign(globalThis, {
    window: {
      open: (...args: string[]) => {
        opened.push(args);
        return popup;
      },
      close: () => undefined,
      setTimeout,
      clearTimeout,
    },
  });
  return opened;
}

function callback(href: string): boolean {
  return HevnConnect.complete(new URL(href) as unknown as Location);
}

function session(nonce: string | null, app = 'https://sandbox.gethevn.com'): string {
  const claims = Buffer.from(JSON.stringify({ partner: 'p', action: 'link', nonce, aud: 'hevn-connect-session' })).toString('base64url');
  return `${app}/connect?session=eyJhbGciOiJFUzI1NiJ9.${claims}.c2ln`;
}

async function navigated(popup: FakePopup): Promise<string> {
  while (popup.location.href === 'about:blank') await new Promise((resolve) => setTimeout(resolve, 1));
  return popup.location.href;
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('HevnConnect', () => {
  it('opens the window at once, runs the server session and resolves only the result carrying its nonce', async () => {
    const popup = new FakePopup();
    const opened = browser(popup);
    const hevn = HevnConnect.open({ environment: 'sandbox' });
    assert.equal(opened.length, 1);
    assert.equal(opened[0]![0], 'about:blank');

    const url = session('nonce-1234');
    const linked = hevn.link(url);
    assert.equal(await navigated(popup), url);

    assert.equal(callback('https://partner.example/hevn/callback?code=other&state=forged-state'), true);
    assert.equal(callback('https://partner.example/hevn/callback?code=jwt-code&state=nonce-1234'), true);

    assert.deepEqual(await linked, { code: 'jwt-code' });
  });

  it('reports a signed payout, and turns a refusal into an error with its code', async () => {
    const popup = new FakePopup();
    browser(popup);
    const hevn = HevnConnect.open({ appUrl: 'https://app.example/' });

    const signed = hevn.sign(session('sign-1', 'https://app.example'));
    await navigated(popup);
    callback('https://partner.example/cb?status=submitted&payout=po_quote-1&reference=0xop&state=sign-1');
    assert.deepEqual(await signed, { status: 'submitted', payoutId: 'po_quote-1', reference: '0xop' });

    popup.location.href = 'about:blank';
    const refused = hevn.sign(session('sign-2', 'https://app.example'));
    await navigated(popup);
    callback('https://partner.example/cb?error=access_denied&state=sign-2');
    await assert.rejects(refused, (error: unknown) => error instanceof HevnConnectError && error.code === 'access_denied');
  });

  it('refuses a session without a nonce or for another HEVN origin without navigating', async () => {
    const popup = new FakePopup();
    browser(popup);
    const hevn = HevnConnect.open({ environment: 'sandbox' });
    const invalid = (error: unknown) => error instanceof HevnConnectError && error.code === 'invalid_session';

    await assert.rejects(hevn.link(session(null)), invalid);
    await assert.rejects(hevn.link('https://sandbox.gethevn.com/connect?session=garbage'), invalid);
    await assert.rejects(hevn.link('not a url'), invalid);
    await assert.rejects(hevn.link(session('n-1', 'https://phish.example')), invalid);
    assert.equal(popup.location.href, 'about:blank');
  });

  it('refuses up front when the browser blocks the window, and ignores a page without state', () => {
    browser(null);
    assert.throws(
      () => HevnConnect.open(),
      (error: unknown) => error instanceof HevnConnectError && error.code === 'popup_blocked',
    );
    assert.equal(callback('https://partner.example/cb?code=x'), false);
  });

  it('gives up after the timeout or when the caller aborts', async () => {
    const popup = new FakePopup();
    browser(popup);
    const controller = new AbortController();
    const slow = HevnConnect.open({ timeoutMs: 5 }).link(session('slow-1'));
    await assert.rejects(slow, (error: unknown) => error instanceof HevnConnectError && error.code === 'timeout');

    const aborted = HevnConnect.open({ signal: controller.signal }).link(session('abort-1'));
    controller.abort();
    await assert.rejects(aborted, (error: unknown) => error instanceof HevnConnectError && error.code === 'aborted');
  });
});

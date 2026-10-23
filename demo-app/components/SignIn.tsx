'use client';

import { HevnConnect } from '@hevn/dapi-sdk/browser';
import { useState } from 'react';

import { Backend } from '@/lib/client/backend';

export function SignIn({ appUrl, onSignedIn }: { appUrl: string; onSignedIn: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setError(null);
    let popup;
    try {
      popup = HevnConnect.open({ appUrl });
    } catch (failure) {
      setError(Backend.describe(failure));
      return;
    }
    setBusy(true);
    try {
      const { url } = await Backend.post<{ url: string }>('/api/auth/session');
      const result = await popup.run(url);
      if (!result.code) throw new Error('The HEVN window returned no sign-in code.');
      await Backend.post('/api/auth/link', { code: result.code, state: result.state });
      onSignedIn();
    } catch (failure) {
      popup.close();
      setError(Backend.describe(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="signin">
      <section className="signin-copy">
        <span className="wordmark">mini HEVN</span>
        <h1>Dollars and euros for your company, in one account.</h1>
        <p className="lead">
          Hold USDC and EURC, receive bank transfers to your own account details and pay anyone with a wallet. Every transfer is approved by you, in HEVN.
        </p>
        <button className="button primary large" onClick={start} disabled={busy}>
          {busy ? 'Waiting for HEVN…' : 'Continue with HEVN'}
        </button>
        {error && (
          <p className="notice bad" role="alert">
            {error}
          </p>
        )}
        <p className="fineprint">
          You sign in to HEVN in a separate window. This site never sees your HEVN password and cannot move your money without your approval.
        </p>
      </section>
      <aside className="signin-note" aria-hidden="true">
        <div className="note-face">
          <span className="note-mark">mini HEVN</span>
          <span className="note-amount">$12,480.00</span>
          <span className="note-meta">Business account, sandbox</span>
          <svg className="note-guilloche" viewBox="0 0 400 240" preserveAspectRatio="none">
            {Array.from({ length: 14 }, (_, index) => (
              <path
                key={index}
                d={`M0 ${120 + index * 3} C 100 ${40 + index * 9}, 300 ${200 - index * 9}, 400 ${120 - index * 3}`}
                fill="none"
                stroke="currentColor"
                strokeWidth="0.6"
              />
            ))}
          </svg>
        </div>
      </aside>
    </main>
  );
}

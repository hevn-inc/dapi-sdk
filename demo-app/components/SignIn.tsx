'use client';

import { HevnConnect } from '@hevn/dapi-sdk/browser';
import { useState, type FormEvent } from 'react';

import { api } from '@/client/api';

export function SignIn({ appUrl, onSignedIn }: { appUrl: string; onSignedIn: () => void }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    let popup;
    try {
      popup = HevnConnect.open({ appUrl });
    } catch (failure) {
      setError(api.describe(failure));
      return;
    }
    setBusy(true);
    try {
      const { url } = await api.startSignIn();
      // HEVN emails a one-time code to this address; the person types it in the HEVN window, not here.
      const result = await popup.run(url, { email });
      if (!result.code) throw new Error('The HEVN window returned no sign-in code.');
      await api.link(result.code, result.state);
      onSignedIn();
    } catch (failure) {
      popup.close();
      setError(api.describe(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="signin">
      <section className="signin-copy">
        <span className="wordmark">Acme Pay</span>
        <h1>Dollars and euros for your company, in one account.</h1>
        <p className="lead">
          Hold USDC and EURC, receive bank transfers to your own account details and pay anyone with a wallet. Every transfer is approved by you, in HEVN.
        </p>
        <form className="signin-form" onSubmit={start}>
          <label className="field">
            <span>Work email</span>
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" autoComplete="email" required />
          </label>
          <button className="button primary large" disabled={busy}>
            {busy ? 'Waiting for HEVN…' : 'Continue with HEVN'}
          </button>
        </form>
        {error && (
          <p className="notice bad" role="alert">
            {error}
          </p>
        )}
        <p className="fineprint">
          HEVN sends a code to this email. You enter it in the HEVN window, so this site never signs in for you and cannot move your money without your
          approval.
        </p>
      </section>
      <aside className="signin-note" aria-hidden="true">
        <div className="note-face">
          <span className="note-mark">Acme Pay</span>
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

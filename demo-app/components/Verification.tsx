'use client';

import { useState } from 'react';

import { api } from '@/client/api';
import { Format } from '@/client/format';
import type { Kyb } from '@/client/types';
import type { Resource } from '@/client/useResource';

import { StatusBadge } from './StatusBadge';

const STEPS = ['Company details', 'Owners and documents', 'Review', 'Verified'];

export function Verification({ kyb, onChanged }: { kyb: Resource<Kyb>; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const status = kyb.data?.status ?? null;
  const reached = busy ? 2 : status === 'approved' ? 4 : status === 'pending' || status === 'rfi' ? 2 : status === 'rejected' ? 3 : 0;
  const needed = missing.length ? missing : status !== 'approved' ? (kyb.data?.missing ?? []) : [];

  const run = async () => {
    setBusy(true);
    setError(null);
    setMissing([]);
    try {
      const result = await api.runKyb();
      if (result.ready === false) setMissing(result.missing ?? []);
    } catch (failure) {
      setError(api.describe(failure));
    } finally {
      setBusy(false);
      onChanged();
    }
  };

  return (
    <section className="panel verification" aria-labelledby="kyb-title">
      <div className="panel-head">
        <div>
          <h2 id="kyb-title">Business verification</h2>
          <p className="panel-sub">Verify your company once to open bank accounts in its name.</p>
        </div>
        {kyb.loading && !kyb.data ? <span className="skeleton-pill" /> : <StatusBadge status={busy ? 'working' : status} />}
      </div>

      <ol className="steps">
        {STEPS.map((step, index) => (
          <li key={step} className={index < reached ? 'done' : index === reached && status !== 'approved' ? 'current' : ''}>
            <span className="step-dot" aria-hidden="true">
              {index < reached ? '✓' : index + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>

      {needed.length > 0 && <p className="notice wait">Still needed: {needed.map((item) => Format.label(item)).join(', ')}</p>}
      {kyb.error ? <p className="notice bad">{api.describe(kyb.error)}</p> : null}
      {error && (
        <p className="notice bad" role="alert">
          {error}
        </p>
      )}

      <div className="panel-actions">
        {status === 'approved' ? (
          <p className="panel-sub">Your business is verified. You can open bank accounts below.</p>
        ) : (
          <>
            <button className="button primary" onClick={run} disabled={busy || kyb.loading}>
              {busy ? 'Verifying, this takes up to a minute…' : 'Verify my business'}
            </button>
            <p className="fineprint">Sandbox: fills in a sample company with documents, files it and approves it as the reviewer.</p>
          </>
        )}
      </div>
    </section>
  );
}

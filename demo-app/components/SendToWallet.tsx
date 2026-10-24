'use client';

import { HevnConnect } from '@hevn/dapi-sdk/browser';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { api } from '@/client/api';
import { Format } from '@/client/format';
import type { AccountBalance, Payout } from '@/client/types';

import { StatusBadge } from './StatusBadge';

const FINAL = new Set(['settled', 'failed', 'refunded']);
const WATCH_MS = 180_000;

export function SendToWallet({ appUrl, available, onSettled }: { appUrl: string; available: AccountBalance[]; onSettled: () => void }) {
  const [address, setAddress] = useState('');
  const [amount, setAmount] = useState('0.01');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payout, setPayout] = useState<Payout | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const usdc = available.find((account) => account.account === 'USDC');

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  const watch = (payoutId: string, until: number) => {
    if (timer.current) window.clearTimeout(timer.current);
    api
      .payout(payoutId)
      .then((fresh) => {
        setPayout(fresh);
        if (FINAL.has(fresh.status)) {
          setStage(null);
          onSettled();
        } else if (Date.now() < until) {
          timer.current = window.setTimeout(() => watch(payoutId, until), 3000);
        } else {
          setStage('Still on its way. Check your activity in a minute.');
        }
      })
      .catch((failure) => setError(api.describe(failure)));
  };

  const send = async (event: FormEvent) => {
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
    setPayout(null);
    setStage('Preparing the transfer…');
    try {
      const created = await api.sendToWallet(address.trim(), amount.trim());
      setPayout(created.payout);
      setStage('Approve the transfer in the HEVN window.');
      const signed = await popup.sign(created.url);
      api.log.note('sign', signed);
      setStage('Approved. Sending…');
      watch(created.payout.id, Date.now() + WATCH_MS);
    } catch (failure) {
      popup.close();
      api.log.note('sign failed', { reason: api.describe(failure) });
      setStage(null);
      setError(api.describe(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel" aria-labelledby="send-title">
      <div className="panel-head">
        <div>
          <h2 id="send-title">Send to a wallet</h2>
          <p className="panel-sub">USDC on Base. You approve every transfer yourself, in HEVN.</p>
        </div>
      </div>

      <form className="send-form" onSubmit={send}>
        <label className="field">
          <span>Recipient wallet</span>
          <input
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="0x…"
            spellCheck={false}
            autoComplete="off"
            className="mono"
            required
            pattern="^0x[0-9a-fA-F]{40}$"
            title="0x followed by 40 hex characters"
          />
        </label>
        <label className="field">
          <span>Amount</span>
          <div className="amount-input">
            <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" required />
            <span>USDC</span>
          </div>
          {usdc && <span className="fineprint">Available {Format.money(usdc.balance)} USDC</span>}
        </label>
        <button className="button primary" disabled={busy}>
          {busy ? 'Waiting for approval…' : 'Review and approve in HEVN'}
        </button>
      </form>

      {payout && (
        <div className="transfer">
          <div className="transfer-head">
            <span>
              {payout.quote ? `${Format.money(payout.quote.toAmount)} ${payout.quote.toCurrency}` : `${amount} USDC`} to{' '}
              {Format.short(payout.contact?.address ?? address, 6, 4)}
            </span>
            <StatusBadge status={payout.status} />
          </div>
          {stage && <p className="fineprint">{stage}</p>}
          {payout.failure && <p className="notice bad">The transfer failed: {payout.failure.code}</p>}
          {payout.transactionHash && (
            <p className="fineprint">
              Transaction <span className="mono">{Format.short(payout.transactionHash, 10, 8)}</span>
            </p>
          )}
        </div>
      )}
      {error && (
        <p className="notice bad" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

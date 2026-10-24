'use client';

import { useState, type FormEvent } from 'react';

import { api } from '@/client/api';
import { Format } from '@/client/format';
import type { Balance } from '@/client/types';
import type { Resource } from '@/client/useResource';

export function BalanceHero({ balance, onDeposited }: { balance: Resource<Balance>; onDeposited: () => void }) {
  const [amount, setAmount] = useState('0.50');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const data = balance.data;
  const pockets = data?.accounts.length ? data.accounts : ['USDC', 'EURC'].map((account) => ({ account, balance: '0', usdValue: '0' }));

  const deposit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await api.deposit(amount.trim());
      setMessage({ tone: 'good', text: `Added ${amount.trim()} test USDC. It can take a few seconds to show up.` });
      onDeposited();
      window.setTimeout(onDeposited, 6000);
    } catch (failure) {
      setMessage({ tone: 'bad', text: api.describe(failure) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="hero" aria-labelledby="balance-title">
      <svg className="hero-guilloche" viewBox="0 0 800 260" preserveAspectRatio="none" aria-hidden="true">
        {Array.from({ length: 18 }, (_, index) => (
          <path
            key={index}
            d={`M0 ${150 + index * 2} C 200 ${30 + index * 8}, 560 ${250 - index * 8}, 800 ${110 - index * 2}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="0.7"
          />
        ))}
      </svg>
      <div className="hero-total">
        <h2 id="balance-title" className="hero-label">
          Total balance
        </h2>
        {data ? (
          <p className="hero-amount">{Format.usd(data.totalUsd)}</p>
        ) : balance.error ? (
          <p className="hero-amount muted">Unavailable</p>
        ) : (
          <p className="hero-amount skeleton-amount" aria-busy="true">
            $0.00
          </p>
        )}
        {data?.baseSmartWallet && (
          <p className="hero-wallet" title={data.baseSmartWallet}>
            Wallet on Base {Format.short(data.baseSmartWallet, 8, 6)}
          </p>
        )}
        {balance.error ? <p className="notice bad on-dark">{api.describe(balance.error)}</p> : null}
      </div>

      <dl className="hero-pockets">
        {pockets.map((pocket) => (
          <div className="pocket" key={pocket.account}>
            <dt>{pocket.account.replace(/_/g, ' ')}</dt>
            <dd>
              <span className="pocket-amount">{Format.money(pocket.balance)}</span>
              <span className="pocket-usd">{Format.usd(pocket.usdValue)}</span>
            </dd>
          </div>
        ))}
      </dl>

      <form className="hero-deposit" onSubmit={deposit}>
        <label htmlFor="deposit-amount">Add test USDC</label>
        <div className="hero-deposit-row">
          <input id="deposit-amount" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} aria-describedby="deposit-hint" />
          <button className="button on-dark" disabled={busy}>
            {busy ? 'Adding…' : 'Simulate deposit'}
          </button>
          <button type="button" className="button ghost-dark" onClick={() => void balance.reload()} disabled={balance.loading}>
            {balance.loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        <p id="deposit-hint" className="hero-hint">
          Sandbox only. At least 0.10, and only while the wallet holds less than 1 USDC.
        </p>
        {message && (
          <p className={`notice ${message.tone} on-dark`} role="status">
            {message.text}
          </p>
        )}
      </form>
    </section>
  );
}

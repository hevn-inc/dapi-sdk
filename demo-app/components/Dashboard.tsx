'use client';

import { useState } from 'react';

import type { Balance, Kyb, Me, RailList, TransactionPage } from '@/lib/client/types';
import { useResource } from '@/lib/client/useResource';

import { Activity } from './Activity';
import { ApiLog } from './ApiLog';
import { BalanceHero } from './BalanceHero';
import { BankAccounts } from './BankAccounts';
import { SendToWallet } from './SendToWallet';
import { Verification } from './Verification';

export function Dashboard({ appUrl, onSignOut }: { appUrl: string; onSignOut: () => void }) {
  const me = useResource<Me>('/api/me');
  const balance = useResource<Balance>('/api/balance');
  const kyb = useResource<Kyb>('/api/kyb');
  const banks = useResource<RailList>('/api/banks');
  const activity = useResource<TransactionPage>('/api/transactions');
  const [logOpen, setLogOpen] = useState(false);

  const moneyMoved = () => {
    void balance.reload();
    void activity.reload();
  };

  return (
    <div className={`shell ${logOpen ? 'log-open' : ''}`}>
      <header className="topbar">
        <span className="wordmark">mini HEVN</span>
        <div className="topbar-who">
          {me.data ? (
            <>
              <span className="who-name">{me.data.name || me.data.email || me.data.id}</span>
              <span className="who-env">{me.data.environment === 'production' ? 'Live' : 'Sandbox'}</span>
            </>
          ) : (
            <span className="skeleton-line short" />
          )}
        </div>
        <button className="button quiet log-toggle" onClick={() => setLogOpen((open) => !open)} aria-expanded={logOpen} aria-controls="api-log">
          {logOpen ? 'Hide API log' : 'API log'}
        </button>
        <button className="button quiet" onClick={onSignOut}>
          Sign out
        </button>
      </header>

      <main className="main">
        <BalanceHero balance={balance} onDeposited={moneyMoved} />
        <Verification kyb={kyb} onChanged={() => void Promise.all([kyb.reload(), banks.reload()])} />
        <div className="columns">
          <BankAccounts banks={banks} kybStatus={kyb.data?.status ?? null} />
          <SendToWallet appUrl={appUrl} available={balance.data?.accounts ?? []} onSettled={moneyMoved} />
        </div>
        <Activity activity={activity} />
      </main>

      <ApiLog />
    </div>
  );
}

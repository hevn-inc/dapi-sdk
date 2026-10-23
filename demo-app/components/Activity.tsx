'use client';

import { Backend } from '@/lib/client/backend';
import { Format } from '@/lib/client/format';
import type { TransactionPage } from '@/lib/client/types';
import type { Resource } from '@/lib/client/useResource';

import { StatusBadge } from './StatusBadge';

export function Activity({ activity }: { activity: Resource<TransactionPage> }) {
  const items = activity.data?.items ?? [];

  return (
    <section className="panel" aria-labelledby="activity-title">
      <div className="panel-head">
        <div>
          <h2 id="activity-title">Activity</h2>
          <p className="panel-sub">The latest money in and out of your account.</p>
        </div>
        <button className="button quiet" onClick={() => void activity.reload()} disabled={activity.loading}>
          {activity.loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      {activity.error ? <p className="notice bad">{Backend.describe(activity.error)}</p> : null}
      {activity.loading && !activity.data ? (
        <div className="skeleton-block" />
      ) : activity.error && !activity.data ? null : items.length === 0 ? (
        <p className="empty">Nothing here yet. Simulate a deposit to see your first transaction.</p>
      ) : (
        <ul className="ledger">
          {items.map((item, index) => {
            const side = item.isIncome ? item.to : item.from;
            return (
              <li key={item.id ?? `${item.createdAt}-${index}`} className="ledger-row">
                <span className={`ledger-sign ${item.isIncome ? 'in' : 'out'}`} aria-hidden="true">
                  {item.isIncome ? '+' : '−'}
                </span>
                <span className="ledger-what">
                  <span className="ledger-title">{item.counterparty || Format.label(item.type)}</span>
                  <span className="ledger-when">{Format.date(item.createdAt)}</span>
                </span>
                <StatusBadge status={item.status} label={Format.label(item.status)} />
                <span className={`ledger-amount ${item.isIncome ? 'in' : ''}`}>
                  {item.isIncome ? '+' : '−'}
                  {Format.money(side?.amount)} {side?.currency}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

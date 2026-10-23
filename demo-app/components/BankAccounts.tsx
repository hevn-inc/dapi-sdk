'use client';

import { useEffect, useState } from 'react';

import { Backend } from '@/lib/client/backend';
import { Format } from '@/lib/client/format';
import type { Rail, RailList, Requirements } from '@/lib/client/types';
import type { Resource } from '@/lib/client/useResource';

import { StatusBadge } from './StatusBadge';

const FIELD_ORDER = ['iban', 'accountNumber', 'routingNumber', 'bic', 'branchNumber', 'financialInstitutionId', 'accountKind', 'pixKey', 'paymentKey'];
const FIELD_LABEL: Record<string, string> = {
  iban: 'IBAN',
  bic: 'BIC / SWIFT',
  accountNumber: 'Account number',
  routingNumber: 'Routing number',
  branchNumber: 'Branch',
  financialInstitutionId: 'Institution number',
  accountKind: 'Account type',
  pixKey: 'PIX key',
  paymentKey: 'Payment key',
};

export function BankAccounts({ banks, kybStatus }: { banks: Resource<RailList>; kybStatus: string | null }) {
  const rails = banks.data?.rails ?? [];
  const opened = rails.filter((rail) => rail.opened);
  const closed = rails.filter((rail) => !rail.opened);
  const [selected, setSelected] = useState('');
  const [requirements, setRequirements] = useState<Requirements | null>(null);
  const [checking, setChecking] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const choice = closed.some((rail) => rail.rail === selected) ? selected : (closed[0]?.rail ?? '');
  const reload = banks.reload;
  const preparing = opened.some((rail) => rail.status === 'preparing' || !rail.requisites);

  useEffect(() => {
    if (!choice) return;
    let current = true;
    setChecking(true);
    setRequirements(null);
    setError(null);
    Backend.get<Requirements>(`/api/banks/${encodeURIComponent(choice)}/requirements`)
      .then((found) => current && setRequirements(found))
      .catch((failure) => current && setError(Backend.describe(failure)))
      .finally(() => current && setChecking(false));
    return () => {
      current = false;
    };
  }, [choice, kybStatus]);

  useEffect(() => {
    if (!preparing) return;
    const timer = window.setTimeout(() => void reload(), 4000);
    return () => window.clearTimeout(timer);
  }, [preparing, banks.data, reload]);

  const open = async () => {
    setOpening(true);
    setError(null);
    try {
      await Backend.post(`/api/banks/${encodeURIComponent(choice)}`);
      await reload();
    } catch (failure) {
      setError(Backend.describe(failure));
    } finally {
      setOpening(false);
    }
  };

  return (
    <section className="panel" aria-labelledby="banks-title">
      <div className="panel-head">
        <div>
          <h2 id="banks-title">Bank accounts</h2>
          <p className="panel-sub">Your own account details. Money sent here lands in your balance as stablecoins.</p>
        </div>
      </div>

      {banks.loading && !banks.data ? (
        <div className="skeleton-block" />
      ) : opened.length === 0 ? (
        <p className="empty">No accounts yet. Pick a currency below to get your first set of details.</p>
      ) : (
        <ul className="accounts">
          {opened.map((rail) => (
            <AccountDetails key={rail.rail} rail={rail} />
          ))}
        </ul>
      )}
      {banks.error ? <p className="notice bad">{Backend.describe(banks.error)}</p> : null}

      {closed.length > 0 && (
        <div className="open-account">
          <h3>Open an account</h3>
          <label className="field">
            <span>Currency and network</span>
            <select value={choice} onChange={(event) => setSelected(event.target.value)}>
              {closed.map((rail) => (
                <option key={rail.rail} value={rail.rail}>
                  {rail.currency} {rail.method.toUpperCase()}, credited as {rail.railCurrency}
                </option>
              ))}
            </select>
          </label>
          {checking ? (
            <p className="fineprint">Checking what this account needs…</p>
          ) : requirements && !requirements.available ? (
            <div className="notice wait">
              <p>Before you can open it:</p>
              <ul>
                {requirements.blockers.map((blocker) => (
                  <li key={blocker.code + blocker.field}>{blocker.message}</li>
                ))}
              </ul>
            </div>
          ) : requirements ? (
            <p className="fineprint">Ready to open.</p>
          ) : null}
          <button className="button primary" onClick={open} disabled={opening || checking || !requirements?.available}>
            {opening ? 'Opening…' : 'Open account'}
          </button>
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

function AccountDetails({ rail }: { rail: Rail }) {
  const [copied, setCopied] = useState<string | null>(null);
  const requisites = rail.requisites;
  const holder = requisites?.holder.businessName ?? [requisites?.holder.firstName, requisites?.holder.lastName].filter(Boolean).join(' ');
  const rows: [string, string][] = requisites
    ? [
        ['Beneficiary', holder],
        ['Bank', requisites.bankName ?? ''],
        ...FIELD_ORDER.filter((key) => requisites.fields[key]).map((key): [string, string] => [
          FIELD_LABEL[key] ?? Format.label(key),
          String(requisites.fields[key]),
        ]),
        ['Reference', requisites.paymentReference ?? ''],
        ['Minimum deposit', rail.minimumDeposit ? `${rail.minimumDeposit} ${rail.currency}` : ''],
      ].filter((row): row is [string, string] => Boolean(row[1]))
    : [];

  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      setCopied(null);
    }
  };

  return (
    <li className="account">
      <div className="account-head">
        <span className="account-currency">{rail.currency}</span>
        <span className="account-name">
          {rail.method.toUpperCase()} account, credited as {rail.railCurrency}
        </span>
        <StatusBadge status={rail.status ?? 'preparing'} />
      </div>
      {requisites ? (
        <dl className="details">
          {rows.map(([label, value]) => (
            <div key={label} className="detail">
              <dt>{label}</dt>
              <dd>
                <span className={/IBAN|number|BIC|Reference/.test(label) ? 'mono' : undefined}>{value}</span>
                <button className="copy" onClick={() => void copy(label, value)} aria-label={`Copy ${label}`}>
                  {copied === label ? 'Copied' : 'Copy'}
                </button>
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="fineprint">Your account details are being prepared. This page checks again every few seconds.</p>
      )}
    </li>
  );
}

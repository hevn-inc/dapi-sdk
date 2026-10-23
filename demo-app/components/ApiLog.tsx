'use client';

import { useEffect, useRef, useState } from 'react';

import { Backend } from '@/lib/client/backend';
import type { LogEntry } from '@/lib/client/types';

const LIMIT = 150;

export function ApiLog() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [paused, setPaused] = useState(false);
  const seen = useRef(0);

  useEffect(() => {
    if (paused) return;
    let alive = true;
    let timer = 0;
    const poll = async () => {
      try {
        const { entries: fresh } = await Backend.get<{ entries: LogEntry[] }>(`/api/log?after=${seen.current}`);
        if (alive && fresh.length) {
          seen.current = Math.max(seen.current, ...fresh.map((entry) => entry.seq));
          setEntries((current) => [...fresh.reverse(), ...current].slice(0, LIMIT));
        }
      } catch (failure) {
        if (failure instanceof Error && 'status' in failure && failure.status === 401) return;
      }
      if (alive) timer = window.setTimeout(poll, 1500);
    };
    void poll();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [paused]);

  const clear = async () => {
    await Backend.call('/api/log', { method: 'DELETE' }).catch(() => undefined);
    setEntries([]);
  };

  return (
    <aside className="log" id="api-log" aria-label="API log">
      <div className="log-head">
        <div>
          <h2>API log</h2>
          <p>Calls this server makes to HEVN on your behalf. Tokens, signatures and file contents are hidden.</p>
        </div>
        <div className="log-actions">
          <button className="log-button" onClick={() => setPaused((value) => !value)}>
            {paused ? 'Resume' : 'Pause'}
          </button>
          <button className="log-button" onClick={clear}>
            Clear
          </button>
        </div>
      </div>
      <div className="log-list">
        {entries.length === 0 ? (
          <p className="log-empty">Requests appear here as you use the app.</p>
        ) : (
          entries.map((entry) => <LogRow key={entry.seq} entry={entry} />)
        )}
      </div>
    </aside>
  );
}

function LogRow({ entry }: { entry: LogEntry }) {
  const tone = entry.source === 'browser' ? 'note' : entry.status >= 400 || entry.status === 0 ? 'bad' : entry.status >= 300 ? 'wait' : 'good';
  return (
    <details className="log-entry">
      <summary>
        <span className={`log-method ${entry.method.toLowerCase()}`}>{entry.method}</span>
        <span className="log-path">{entry.path.replace(/^\/dapi\/v1/, '')}</span>
        <span className={`log-status ${tone}`}>{entry.source === 'browser' ? 'window' : entry.status || 'error'}</span>
        <span className="log-meta">
          {entry.at.slice(11, 19)}
          {entry.source === 'server' ? `, ${entry.durationMs} ms` : ''}
          {entry.account ? `, as ${entry.account}` : ''}
        </span>
      </summary>
      <div className="log-body">
        {entry.request !== null && (
          <>
            <h3>Request</h3>
            <JsonTree value={entry.request} depth={0} />
          </>
        )}
        <h3>Response</h3>
        <JsonTree value={entry.response} depth={0} />
      </div>
    </details>
  );
}

function JsonTree({ value, name, depth }: { value: unknown; name?: string | number; depth: number }) {
  const key = name === undefined ? null : <span className="j-key">{name}: </span>;
  if (value === null || typeof value !== 'object') {
    const kind = typeof value === 'string' ? 'j-str' : typeof value === 'number' ? 'j-num' : 'j-lit';
    return (
      <div className="j-leaf">
        {key}
        <span className={kind}>{typeof value === 'string' ? `"${value}"` : String(value)}</span>
      </div>
    );
  }
  const items: [string | number, unknown][] = Array.isArray(value) ? value.map((item, index) => [index, item]) : Object.entries(value);
  if (!items.length)
    return (
      <div className="j-leaf">
        {key}
        <span className="j-lit">{Array.isArray(value) ? '[]' : '{}'}</span>
      </div>
    );
  return (
    <details className="j-node" open={depth < 1}>
      <summary>
        {key}
        <span className="j-lit">{Array.isArray(value) ? `[${items.length}]` : `{${items.length}}`}</span>
      </summary>
      {items.map(([child, item]) => (
        <JsonTree key={child} value={item} name={child} depth={depth + 1} />
      ))}
    </details>
  );
}

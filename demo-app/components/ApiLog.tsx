'use client';

import { useEffect, useRef, useState } from 'react';

import { api } from '@/client/api';
import type { LogEntry } from '@/client/api';

const LIMIT = 150;

interface Row extends LogEntry {
  id: number;
  at: string;
}

export function ApiLog() {
  const [rows, setRows] = useState<Row[]>([]);
  const [paused, setPaused] = useState(false);
  const nextId = useRef(0);

  useEffect(() => {
    if (paused) return;
    return api.log.subscribe((entries) => {
      const at = new Date().toTimeString().slice(0, 8);
      const fresh = entries.map((entry) => ({ ...entry, id: nextId.current++, at }));
      setRows((current) => [...fresh.reverse(), ...current].slice(0, LIMIT));
    });
  }, [paused]);

  return (
    <aside className="log" id="api-log" aria-label="API log">
      <div className="log-head">
        <div>
          <h2>API log</h2>
          <p>Calls this site's server made to HEVN for each of your actions. Tokens, codes and file contents are hidden.</p>
        </div>
        <div className="log-actions">
          <button className="log-button" onClick={() => setPaused((value) => !value)}>
            {paused ? 'Resume' : 'Pause'}
          </button>
          <button className="log-button" onClick={() => setRows([])}>
            Clear
          </button>
        </div>
      </div>
      <div className="log-list">
        {rows.length === 0 ? <p className="log-empty">Requests appear here as you use the app.</p> : rows.map((row) => <LogRow key={row.id} row={row} />)}
      </div>
    </aside>
  );
}

function LogRow({ row }: { row: Row }) {
  const tone = row.source === 'window' ? 'note' : row.status >= 400 ? 'bad' : row.status >= 300 ? 'wait' : 'good';
  return (
    <details className="log-entry">
      <summary>
        <span className={`log-method ${row.method.toLowerCase()}`}>{row.method}</span>
        <span className="log-path">{row.path}</span>
        <span className={`log-status ${tone}`}>{row.source === 'window' ? 'window' : row.status}</span>
        <span className="log-meta">
          {row.at}
          {row.source === 'hevn' ? `, ${row.ms} ms` : ''}
          {row.account ? `, as ${row.account}` : ''}
        </span>
      </summary>
      <div className="log-body">
        {row.request !== null && (
          <>
            <h3>Request</h3>
            <JsonTree value={row.request} depth={0} />
          </>
        )}
        <h3>Response</h3>
        <JsonTree value={row.response} depth={0} />
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

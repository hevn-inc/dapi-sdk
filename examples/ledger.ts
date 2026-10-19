import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { DeveloperKey, Hevn } from '../src/index.ts';

const [clientId, since = new Date(Date.now() - 86_400_000).toISOString(), outDir = 'exports'] = process.argv.slice(2);
if (!clientId) {
  console.error('usage: node examples/ledger.ts <cl_…> [since ISO-8601] [out dir]');
  process.exit(1);
}

interface Row {
  id: string;
  type: string;
  status: string;
  isIncome: boolean;
  from: { amount: string; currency: string };
  to: { amount: string; currency: string };
  counterparty?: string;
  createdAt: string;
}

const hevn = Hevn.connect({ key: DeveloperKey.fromEnv(), email: process.env.HEVN_EMAIL ?? '' });
const client = hevn.actingAs(clientId);

// Reconcile from a watermark: walk the cursor to the end, newest first.
const rows: Row[] = [];
for (let cursor: string | undefined; ; ) {
  const page = await client.transactions.list<Row>({ from: since, limit: 50, cursor });
  rows.push(...page.items);
  cursor = page.nextCursor ?? undefined;
  if (!cursor) break;
}
for (const row of rows) {
  console.log(
    'row',
    row.id,
    row.type,
    row.status,
    row.isIncome ? 'in' : 'out',
    `${row.from.amount} ${row.from.currency} -> ${row.to.amount} ${row.to.currency}`,
    row.counterparty ?? '',
  );
}

const summary = await client.transactions.summary<{ inflowUsd: string; inflowCount: number; outflowUsd: string; outflowCount: number }>({ from: since });
console.log('summary in', summary.inflowUsd, summary.inflowCount, 'out', summary.outflowUsd, summary.outflowCount);

// Exports stream a file: the list as CSV, a receipt per transaction, and a statement per virtual account.
mkdirSync(outDir, { recursive: true });
console.log('export', await client.transactions.export({ from: since, format: 'csv' }, join(outDir, `${clientId}.csv`)));
const [newest] = rows;
if (newest) {
  console.log('export', await client.transactions.export({ kind: 'receipt', transactionId: newest.id, format: 'pdf' }, join(outDir, `${newest.id}.pdf`)));
}
const { rails } = await client.banks.list<{ rails: { id?: string; status?: string }[] }>();
for (const { id } of rails.filter((r) => r.status === 'active')) {
  console.log('export', await client.transactions.export({ kind: 'statement', bankId: id, format: 'pdf' }, join(outDir, `${id}-statement.pdf`)));
}

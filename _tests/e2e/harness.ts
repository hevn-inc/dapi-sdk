// Runs examples/*.ts against the live sandbox as child processes and inspects the result through the SDK.
// Credentials come from the environment or ./.env: HEVN_EMAIL, and HEVN_KEY_PEM as a path or an inline PEM.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { DeveloperKey, Hevn, pollUntil, type Client, type ClientId } from '../../src/index.ts';

const run = promisify(execFile);

export interface Sandbox {
  keyPath: string;
  email: string;
}

/** The sandbox credentials, or a skip reason when they are missing. An inline PEM is written to a temp file so examples can use `DeveloperKey.fromEnv()`. */
export function sandbox(): Sandbox | string {
  const dotenv = existsSync('.env') ? readFileSync('.env', 'utf8') : '';
  const source = process.env.HEVN_KEY_PEM ?? dotenv;
  const inline = source.match(/-----BEGIN [A-Z ]+-----[\s\S]+?-----END [A-Z ]+-----/)?.[0];
  const path = (process.env.HEVN_KEY_PEM ?? dotenv.match(/^HEVN_KEY_PEM=([^\n]*)/m)?.[1])?.trim();
  const email = process.env.HEVN_EMAIL ?? dotenv.match(/^HEVN_EMAIL=(.+)$/m)?.[1]?.trim();
  if (!email || (!inline && !(path && existsSync(path)))) return 'HEVN_KEY_PEM and HEVN_EMAIL are required for the sandbox e2e';
  if (!inline) return { keyPath: path!, email };
  const keyPath = join(mkdtempSync(join(tmpdir(), 'dapi-e2e-')), 'key.pem');
  writeFileSync(keyPath, inline, { mode: 0o600 });
  return { keyPath, email };
}

export function connect(env: Sandbox): Hevn {
  return Hevn.connect({ key: DeveloperKey.fromFile(env.keyPath), email: env.email });
}

/** Runs `node examples/<name>.ts ...args` and returns its stdout; a non-zero exit fails with the example's output attached. */
export async function example(env: Sandbox, name: string, args: string[] = []): Promise<string> {
  try {
    const { stdout } = await run(process.execPath, [`examples/${name}.ts`, ...args], {
      env: { ...process.env, HEVN_KEY_PEM: env.keyPath, HEVN_EMAIL: env.email, HEVN_ENV: 'sandbox' }, // HEVN_API_URL passes through
      timeout: 540_000,
    });
    process.stdout.write(stdout.replace(/^/gm, `  [${name}] `));
    return stdout;
  } catch (error) {
    const { stdout = '', stderr = '' } = error as { stdout?: string; stderr?: string };
    assert.fail(`examples/${name}.ts failed\n${stdout}${stderr}`);
  }
}

/** The first capture group of `pattern` in an example's output. */
export function field(output: string, pattern: RegExp): string {
  const value = output.match(pattern)?.[1];
  assert.ok(value, `no ${pattern} in example output:\n${output}`);
  return value;
}

/** The first two ready clients from `GET /clients`; the run reuses them instead of creating new ones. */
export async function existingClients(hevn: Hevn): Promise<[Client, Client]> {
  const { items } = await hevn.clients.list({ limit: 50 });
  const ready = items.filter((client) => client.status === 'ready' && client.baseSmartWallet);
  assert.ok(ready.length >= 2, `need two ready clients in the sandbox, found ${ready.length}`);
  return [ready[0]!, ready[1]!];
}

interface Balance {
  accounts: { account: string; balance: string }[];
}

/** USDC balance in micro-units, so that deltas compare exactly. */
export async function usdc(hevn: Hevn, clientId: ClientId): Promise<number> {
  const balance = await hevn.actingAs(clientId).clients.balance<Balance>();
  return Math.round(Number(balance.accounts.find((row) => row.account === 'USDC')?.balance ?? 0) * 1e6);
}

/** Waits until the client's USDC balance moves by `delta` (USDC) from `before`, then returns the actual move. */
export async function usdcChange(hevn: Hevn, clientId: ClientId, before: number, delta: number): Promise<number> {
  const target = before + Math.round(delta * 1e6);
  const after = await pollUntil(() => usdc(hevn, clientId), (seen) => seen === target, { firstMs: 2_000, deadlineMs: 180_000 }).catch(() =>
    usdc(hevn, clientId),
  );
  return (after - before) / 1e6;
}

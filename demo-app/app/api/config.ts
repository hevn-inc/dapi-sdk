import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const envFile = resolve(process.cwd(), '..', '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const origin = (process.env.DEMO_ORIGIN ?? `http://localhost:${process.env.PORT ?? 8092}`).replace(/\/$/, '');

/** Everything the demo reads from the environment, in one place. */
export const config = {
  origin,
  redirectUri: `${origin}/callback`,
  appUrl: process.env.HEVN_APP_URL ?? 'http://localhost:8081',
  email: process.env.HEVN_EMAIL ?? '',
  sessionSecret: process.env.DEMO_SESSION_SECRET ?? randomBytes(32).toString('hex'),
};

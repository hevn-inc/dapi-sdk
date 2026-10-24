import { createHmac, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const envFile = resolve(process.cwd(), '..', '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

/**
 * Signs the session cookies. Next recompiles API routes in development, so a secret picked at random here would change
 * under a signed-in visitor; without DEMO_SESSION_SECRET it is derived from the developer key, which stays put.
 */
function sessionSecret(): string {
  if (process.env.DEMO_SESSION_SECRET) return process.env.DEMO_SESSION_SECRET;
  const key = process.env.HEVN_KEY_PEM;
  if (!key) return randomBytes(32).toString('hex');
  // Like DeveloperKey.fromEnv(), HEVN_KEY_PEM holds either the PEM itself or the path to its file.
  const pem = key.trimStart().startsWith('-----BEGIN') ? key : readFileSync(key, 'utf8');
  return createHmac('sha256', pem).update('acme-pay-session').digest('hex');
}

const origin = (process.env.DEMO_ORIGIN ?? `http://localhost:${process.env.PORT ?? 8092}`).replace(/\/$/, '');

/** Everything the demo reads from the environment, in one place. */
export const config = {
  origin,
  redirectUri: `${origin}/callback`,
  appUrl: process.env.HEVN_APP_URL ?? 'http://localhost:8081',
  email: process.env.HEVN_EMAIL ?? '',
  sessionSecret: sessionSecret(),
};

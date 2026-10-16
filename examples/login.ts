import { DeveloperKey, Hevn } from '../src/index.ts';

const key = DeveloperKey.fromEnv();
const hevn = Hevn.connect({ key, email: process.env.HEVN_EMAIL ?? '' });

console.log('developer key', key.fingerprint);
const tokens = await hevn.login();
console.log('session for', tokens.userId, 'expires in', tokens.expiresIn, 's');

const me = await hevn.me();
console.log('own account', await me.clients.current());
console.log('clients', (await hevn.clients.list({ limit: 5 })).items);

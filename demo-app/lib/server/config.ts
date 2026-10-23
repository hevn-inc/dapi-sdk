import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

interface ConfigState {
  loaded: boolean;
  secret: Buffer | null;
}

const shared = globalThis as typeof globalThis & { __neobankConfig?: ConfigState };

export class Config {
  static readonly REQUIRED = ['HEVN_KEY_PEM', 'HEVN_EMAIL', 'HEVN_API_URL'];
  static readonly ROOT = resolve(process.cwd(), '..');

  static get state(): ConfigState {
    shared.__neobankConfig ??= { loaded: false, secret: null };
    return shared.__neobankConfig;
  }

  static load(): void {
    if (Config.state.loaded) return;
    const file = resolve(Config.ROOT, '.env');
    if (existsSync(file)) process.loadEnvFile(file);
    Config.state.loaded = true;
    const missing = Config.REQUIRED.filter((name) => !process.env[name]);
    if (missing.length) throw new Error(`Missing ${missing.join(', ')} in ${file}`);
  }

  static get origin(): string {
    return (process.env.DEMO_ORIGIN ?? `http://localhost:${process.env.PORT ?? 8092}`).replace(/\/$/, '');
  }

  static get redirectUri(): string {
    return `${Config.origin}/callback`;
  }

  static get appUrl(): string {
    Config.load();
    return process.env.HEVN_APP_URL ?? 'http://localhost:8081';
  }

  static get secure(): boolean {
    return Config.origin.startsWith('https://');
  }

  static get paper(): string {
    return resolve(Config.ROOT, 'examples/papers/sample.pdf');
  }

  static get secret(): Buffer {
    if (Config.state.secret) return Config.state.secret;
    Config.load();
    const configured = process.env.DEMO_SESSION_SECRET;
    if (configured && configured.length >= 32) {
      Config.state.secret = Buffer.from(configured, 'utf8');
    } else {
      console.warn('[neobank] DEMO_SESSION_SECRET is unset or shorter than 32 characters; using a random secret, sessions end when the server restarts');
      Config.state.secret = randomBytes(32);
    }
    return Config.state.secret;
  }
}

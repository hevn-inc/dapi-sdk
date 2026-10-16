import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { Base64 } from './encoding.ts';

export class KeyFormatError extends Error {
  override name = 'KeyFormatError';
}

export class PublicKeys {
  static readonly MAX_LENGTH = 4096;
  static readonly CURVE = 'prime256v1';

  static parse(publicKey: string): KeyObject {
    if (typeof publicKey !== 'string' || publicKey.includes('-----BEGIN')) {
      throw new KeyFormatError('publicKey must be base64 DER SubjectPublicKeyInfo, not PEM');
    }
    if (publicKey.length > PublicKeys.MAX_LENGTH) throw new KeyFormatError(`publicKey is longer than ${PublicKeys.MAX_LENGTH} characters`);
    let der: Buffer;
    try {
      der = Base64.decode(publicKey, 'publicKey');
    } catch (error) {
      throw new KeyFormatError((error as Error).message);
    }
    let key: KeyObject;
    try {
      key = createPublicKey({ key: der, format: 'der', type: 'spki' });
    } catch {
      throw new KeyFormatError('publicKey is not a DER SubjectPublicKeyInfo');
    }
    PublicKeys.requireP256(key);
    return key;
  }

  static encode(key: KeyObject): string {
    const publicKey = key.type === 'private' ? createPublicKey(key) : key;
    PublicKeys.requireP256(publicKey);
    return Base64.encode(publicKey.export({ type: 'spki', format: 'der' }));
  }

  static fingerprint(publicKey: string): string {
    const der = PublicKeys.parse(publicKey).export({ type: 'spki', format: 'der' });
    return `sha256:${createHash('sha256').update(der).digest('hex')}`;
  }

  static verifies(publicKey: string, signature: string, message: Uint8Array): boolean {
    if (!Signatures.isWireFormat(signature)) return false;
    try {
      return verify('sha256', message, { key: PublicKeys.parse(publicKey), dsaEncoding: 'der' }, Buffer.from(signature, 'base64'));
    } catch {
      return false;
    }
  }

  static requireP256(key: KeyObject): void {
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== PublicKeys.CURVE) {
      throw new KeyFormatError('The developer key must be an EC key on P-256 (secp256r1 / prime256v1)');
    }
  }
}

export class Signatures {
  static readonly MAX_LENGTH = 2048;

  static isWireFormat(signature: string): boolean {
    if (typeof signature !== 'string' || signature.length > Signatures.MAX_LENGTH || !Base64.isStrict(signature)) return false;
    return Signatures.isDer(Buffer.from(signature, 'base64'));
  }

  static isDer(bytes: Uint8Array): boolean {
    if (bytes.length < 8 || bytes[0] !== 0x30 || bytes[1] !== bytes.length - 2) return false;
    let offset = 2;
    for (let part = 0; part < 2; part += 1) {
      if (bytes[offset] !== 0x02) return false;
      const length = bytes[offset + 1];
      if (length === 0 || length > 33 || offset + 2 + length > bytes.length) return false;
      offset += 2 + length;
    }
    return offset === bytes.length;
  }

  static fromP1363(raw: Uint8Array): string {
    if (raw.length !== 64) throw new KeyFormatError('A raw P-256 signature is exactly 64 bytes (r‖s)');
    const integer = (half: Uint8Array) => {
      let start = 0;
      while (start < half.length - 1 && half[start] === 0) start += 1;
      const trimmed = half.subarray(start);
      const padded = trimmed[0] & 0x80 ? Buffer.concat([Buffer.from([0]), trimmed]) : Buffer.from(trimmed);
      return Buffer.concat([Buffer.from([0x02, padded.length]), padded]);
    };
    const body = Buffer.concat([integer(raw.subarray(0, 32)), integer(raw.subarray(32))]);
    return Base64.encode(Buffer.concat([Buffer.from([0x30, body.length]), body]));
  }
}

export class DeveloperKey {
  readonly publicKey: string;
  readonly fingerprint: string;
  readonly #key: KeyObject;

  constructor(key: KeyObject) {
    if (key.type !== 'private') throw new KeyFormatError('A developer key must be the private half');
    PublicKeys.requireP256(key);
    this.#key = key;
    this.publicKey = PublicKeys.encode(key);
    this.fingerprint = PublicKeys.fingerprint(this.publicKey);
  }

  static fromPem(pem: string | Buffer): DeveloperKey {
    let key: KeyObject;
    try {
      key = createPrivateKey(pem);
    } catch {
      throw new KeyFormatError('The developer key is not a readable PEM private key');
    }
    return new DeveloperKey(key);
  }

  static fromFile(path: string): DeveloperKey {
    return DeveloperKey.fromPem(readFileSync(path));
  }

  static fromEnv(): DeveloperKey {
    const path = process.env.HEVN_KEY_PEM;
    if (!path) throw new KeyFormatError('HEVN_KEY_PEM must point to the developer key PEM file');
    return DeveloperKey.fromFile(path);
  }

  static generate(): DeveloperKey {
    return new DeveloperKey(generateKeyPairSync('ec', { namedCurve: PublicKeys.CURVE }).privateKey);
  }

  signBytes(message: Uint8Array): string {
    return Base64.encode(sign('sha256', message, { key: this.#key, dsaEncoding: 'der' }));
  }

  signPayload(payload: string): string {
    return this.signBytes(Base64.decode(payload, 'approval.payload'));
  }

  verifies(signature: string, message: Uint8Array): boolean {
    return PublicKeys.verifies(this.publicKey, signature, message);
  }

  matches(publicKey: string): boolean {
    try {
      return PublicKeys.fingerprint(publicKey) === this.fingerprint;
    } catch {
      return false;
    }
  }

  toPem(): string {
    return this.#key.export({ type: 'pkcs8', format: 'pem' }).toString();
  }

  toJSON(): { publicKey: string; fingerprint: string } {
    return { publicKey: this.publicKey, fingerprint: this.fingerprint };
  }
}

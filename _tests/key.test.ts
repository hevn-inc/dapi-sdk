import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, it } from 'node:test';

import { DeveloperKey, KeyFormatError, PublicKeys, Signatures } from '../src/index.ts';

describe('DeveloperKey', () => {
  const key = DeveloperKey.generate();

  it('exposes the public half as base64 DER SPKI with a sha256 fingerprint', () => {
    assert.match(key.publicKey, /^MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE[A-Za-z0-9+/]+=*$/);
    assert.match(key.fingerprint, /^sha256:[0-9a-f]{64}$/);
    assert.equal(PublicKeys.fingerprint(key.publicKey), key.fingerprint);
  });

  it('signs bytes as base64 DER that verifies against the public key', () => {
    const message = Buffer.from('hevn-developer-key-login:a@b.co:1:2');
    const signature = key.signBytes(message);
    assert.equal(Signatures.isWireFormat(signature), true);
    assert.equal(PublicKeys.verifies(key.publicKey, signature, message), true);
    assert.equal(PublicKeys.verifies(key.publicKey, signature, Buffer.from('other')), false);
  });

  it('signs the decoded payload bytes, not the base64 text', () => {
    const payload = Buffer.from('{"a":1}').toString('base64');
    const signature = key.signPayload(payload);
    assert.equal(key.verifies(signature, Buffer.from('{"a":1}')), true);
    assert.equal(key.verifies(signature, Buffer.from(payload)), false);
  });

  it('round-trips through PEM', () => {
    const again = DeveloperKey.fromPem(key.toPem());
    assert.equal(again.publicKey, key.publicKey);
    assert.equal(again.matches(key.publicKey), true);
    assert.equal(DeveloperKey.generate().matches(key.publicKey), false);
  });

  it('refuses keys that are not P-256', () => {
    assert.throws(() => new DeveloperKey(generateKeyPairSync('ec', { namedCurve: 'secp256k1' }).privateKey), KeyFormatError);
    assert.throws(() => new DeveloperKey(generateKeyPairSync('ed25519').privateKey), KeyFormatError);
    assert.throws(() => DeveloperKey.fromPem('not a key'), KeyFormatError);
  });

  it('refuses PEM armour, base64url and garbage as a public key', () => {
    const pem = `-----BEGIN PUBLIC KEY-----\n${key.publicKey}\n-----END PUBLIC KEY-----`;
    assert.throws(() => PublicKeys.parse(pem), KeyFormatError);
    assert.throws(() => PublicKeys.parse(key.publicKey.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')), KeyFormatError);
    assert.throws(() => PublicKeys.parse('AAAA'), KeyFormatError);
  });
});

describe('Signatures', () => {
  const key = DeveloperKey.generate();
  const message = Buffer.from('payload');

  it('rejects raw r‖s and wrapped signatures', () => {
    const raw = sign('sha256', message, { key: key.toPem(), dsaEncoding: 'ieee-p1363' });
    assert.equal(raw.length, 64);
    assert.equal(Signatures.isWireFormat(raw.toString('base64')), false);
    const der = key.signBytes(message);
    assert.equal(Signatures.isWireFormat(`${der}\n`), false);
    assert.equal(Signatures.isWireFormat(`${der.slice(0, 20)}\n${der.slice(20)}`), false);
  });

  it('converts a WebCrypto-style P1363 signature to DER', () => {
    const raw = sign('sha256', message, { key: key.toPem(), dsaEncoding: 'ieee-p1363' });
    const der = Signatures.fromP1363(raw);
    assert.equal(Signatures.isWireFormat(der), true);
    assert.equal(key.verifies(der, message), true);
  });
});

import { describe, it, expect, afterEach } from 'vitest';
import {
  sha256Hex,
  sha256HexOfString,
  base64ToBytes,
  bytesToBase64,
  bytesToHex,
  isEd25519Supported,
  verifyEd25519,
  _resetEd25519SupportCacheForTests,
} from '../packCrypto';

afterEach(() => {
  _resetEd25519SupportCacheForTests();
});

describe('sha256HexOfString', () => {
  it('matches a known SHA-256 test vector', async () => {
    // SHA-256("abc")
    expect(await sha256HexOfString('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('is deterministic', async () => {
    const a = await sha256HexOfString('hello world');
    const b = await sha256HexOfString('hello world');
    expect(a).toBe(b);
  });

  it('changes when content changes by a single byte', async () => {
    const a = await sha256HexOfString('hello world');
    const b = await sha256HexOfString('hello worle');
    expect(a).not.toBe(b);
  });
});

describe('sha256Hex', () => {
  it('produces a 64-hex-char digest', async () => {
    const digest = await sha256Hex(new TextEncoder().encode('test'));
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('base64ToBytes / bytesToBase64 round-trip', () => {
  it('round-trips arbitrary bytes', () => {
    const original = new Uint8Array([0, 1, 2, 253, 254, 255, 127, 128]);
    const encoded = bytesToBase64(original);
    const decoded = base64ToBytes(encoded);
    expect(decoded).not.toBeNull();
    expect(Array.from(decoded as Uint8Array)).toEqual(Array.from(original));
  });

  it('rejects malformed base64 without throwing', () => {
    expect(base64ToBytes('not-valid-base64!!')).toBeNull();
    expect(base64ToBytes('')).toBeNull();
    expect(base64ToBytes('abc')).toBeNull(); // not a multiple of 4
  });
});

describe('bytesToHex', () => {
  it('formats bytes as lowercase, zero-padded hex', () => {
    expect(bytesToHex(new Uint8Array([0, 255, 16]))).toBe('00ff10');
  });
});

describe('isEd25519Supported', () => {
  it('resolves to a boolean and is cached (same promise on repeat calls)', async () => {
    const p1 = isEd25519Supported();
    const p2 = isEd25519Supported();
    expect(p1).toBe(p2);
    expect(typeof (await p1)).toBe('boolean');
  });
});

describe('verifyEd25519 — using Vitest/jsdom global crypto (Node webcrypto)', () => {
  it('returns true for a signature produced by the matching private key', async () => {
    const supported = await isEd25519Supported();
    if (!supported) {
      // Environment cannot run Ed25519 — document rather than fail silently.
      console.warn('Ed25519 not supported in this test environment; skipping positive-path assertion.');
      return;
    }
    const { generateKeyPairSync, sign } = await import('node:crypto');
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const publicJwk = publicKey.export({ format: 'jwk' }) as { x: string };
    const rawPublicKey = Buffer.from(publicJwk.x, 'base64url');
    const message = new TextEncoder().encode('{"a":1,"b":2}');
    const signature = sign(null, Buffer.from(message), privateKey);

    const result = await verifyEd25519({
      publicKeyBase64: rawPublicKey.toString('base64'),
      signatureBase64: signature.toString('base64'),
      message,
    });
    expect(result).toBe(true);
  });

  it('returns false when the message has been tampered with', async () => {
    const supported = await isEd25519Supported();
    if (!supported) return;
    const { generateKeyPairSync, sign } = await import('node:crypto');
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const publicJwk = publicKey.export({ format: 'jwk' }) as { x: string };
    const rawPublicKey = Buffer.from(publicJwk.x, 'base64url');
    const originalMessage = new TextEncoder().encode('{"a":1}');
    const signature = sign(null, Buffer.from(originalMessage), privateKey);

    const tamperedMessage = new TextEncoder().encode('{"a":2}');
    const result = await verifyEd25519({
      publicKeyBase64: rawPublicKey.toString('base64'),
      signatureBase64: signature.toString('base64'),
      message: tamperedMessage,
    });
    expect(result).toBe(false);
  });

  it('returns false for a structurally malformed public key (wrong length)', async () => {
    const supported = await isEd25519Supported();
    if (!supported) return;
    const result = await verifyEd25519({
      publicKeyBase64: bytesToBase64(new Uint8Array(10)),
      signatureBase64: bytesToBase64(new Uint8Array(64)),
      message: new TextEncoder().encode('x'),
    });
    expect(result).toBe(false);
  });
});

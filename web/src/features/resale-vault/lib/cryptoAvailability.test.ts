import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  isSubtleCryptoAvailable,
  isIndexedDbAvailable,
  requireSubtleCrypto,
  CryptoUnavailableError,
} from './cryptoAvailability';

describe('cryptoAvailability', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports subtle crypto as available in this test environment (Node/jsdom webcrypto)', () => {
    expect(isSubtleCryptoAvailable()).toBe(true);
  });

  it('reports indexedDB as unavailable in this test environment', () => {
    expect(isIndexedDbAvailable()).toBe(false);
  });

  it('requireSubtleCrypto returns the SubtleCrypto instance when available', () => {
    expect(requireSubtleCrypto()).toBe(globalThis.crypto.subtle);
  });

  it('requireSubtleCrypto throws CryptoUnavailableError (not a silent fallback) when crypto.subtle is missing', () => {
    const originalCrypto = globalThis.crypto;
    vi.stubGlobal('crypto', { ...originalCrypto, subtle: undefined });
    expect(() => requireSubtleCrypto()).toThrow(CryptoUnavailableError);
    expect(isSubtleCryptoAvailable()).toBe(false);
  });

  it('requireSubtleCrypto throws when crypto itself is undefined', () => {
    vi.stubGlobal('crypto', undefined);
    expect(() => requireSubtleCrypto()).toThrow(CryptoUnavailableError);
  });
});

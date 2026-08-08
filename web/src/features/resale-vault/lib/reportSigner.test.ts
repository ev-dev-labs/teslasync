import { describe, it, expect, beforeEach, vi } from 'vitest';
import { signReport, digestReport } from './reportSigner';
import { verifyReport } from './reportVerifier';
import { __resetKeyRepositoryForTests, generateSigningKey, revokeSigningKey } from './signingKeyRepository';
import { makeMinimalReport } from './testFixtures';
import { CryptoUnavailableError } from './cryptoAvailability';

describe('reportSigner + reportVerifier round trip', () => {
  beforeEach(() => {
    __resetKeyRepositoryForTests();
  });

  it('signs a report and verifies it as valid, with digestMatches and signatureValid both true', async () => {
    const report = makeMinimalReport();
    const signed = await signReport(report);

    expect(signed.digest_sha256_hex).toBe(await digestReport(report));
    expect(signed.signature.alg).toBe('ECDSA_P256_SHA256');
    expect(signed.signature.public_key_jwk.kty).toBe('EC');

    const result = await verifyReport(signed);
    expect(result.digestMatches).toBe(true);
    expect(result.signatureValid).toBe(true);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.attestationNote).toMatch(/does NOT verify the identity/);
  });

  it('generates a signing key automatically on first use if none exists yet', async () => {
    const report = makeMinimalReport();
    const signed = await signReport(report);
    expect(signed.signature.key_id).toMatch(/^key_/);
    expect(signed.local_key_status.revoked).toBe(false);
  });

  it('marks local_key_status.persisted according to the key repository (false without IndexedDB)', async () => {
    const signed = await signReport(makeMinimalReport());
    expect(signed.local_key_status.persisted).toBe(false);
  });

  it('detects tampering: mutating the report after signing fails both digest and signature checks', async () => {
    const report = makeMinimalReport();
    const signed = await signReport(report);

    const tampered = {
      ...signed,
      report: { ...signed.report, limitations: ['An attacker changed this after signing.'] },
    };

    const result = await verifyReport(tampered);
    expect(result.digestMatches).toBe(false);
    expect(result.signatureValid).toBe(false);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /digest mismatch/i.test(e))).toBe(true);
    expect(result.errors.some((e) => /signature verification failed/i.test(e))).toBe(true);
  });

  it('detects a forged digest paired with unmodified content+signature (still fails, since digest is not the signature)', async () => {
    const signed = await signReport(makeMinimalReport());
    const forged = { ...signed, digest_sha256_hex: '0'.repeat(64) };
    const result = await verifyReport(forged);
    expect(result.digestMatches).toBe(false);
    // The ECDSA signature is over the report content, not the stored digest
    // string, so a forged digest field alone does not break the signature.
    expect(result.signatureValid).toBe(true);
    expect(result.valid).toBe(false);
  });

  it('rejects a signature produced by the wrong key (public key swapped for another valid key)', async () => {
    const signedA = await signReport(makeMinimalReport());
    const otherKey = await generateSigningKey();
    const forged = {
      ...signedA,
      signature: { ...signedA.signature, key_id: otherKey.key_id, public_key_jwk: otherKey.public_jwk },
    };
    const result = await verifyReport(forged);
    expect(result.signatureValid).toBe(false);
    expect(result.valid).toBe(false);
  });

  it('flags a report signed with a key that has since been revoked locally, while the signature remains cryptographically valid', async () => {
    const signed = await signReport(makeMinimalReport());
    await revokeSigningKey(signed.signature.key_id, 'compromised');
    const result = await verifyReport(signed);
    expect(result.signatureValid).toBe(true);
    expect(result.isKnownLocalKey).toBe(true);
    expect(result.localKeyRevoked).toBe(true);
    expect(result.errors.some((e) => /revoked/i.test(e))).toBe(true);
  });

  it('reports isKnownLocalKey:false for a signature whose key this browser does not have registered (e.g. an imported report)', async () => {
    const signed = await signReport(makeMinimalReport());
    // Simulate "imported from elsewhere": the local registry has no memory
    // of this key.
    __resetKeyRepositoryForTests();
    const result = await verifyReport(signed);
    expect(result.signatureValid).toBe(true);
    expect(result.isKnownLocalKey).toBe(false);
    expect(result.localKeyRevoked).toBeNull();
  });

  it('throws CryptoUnavailableError from signReport when Web Crypto is unavailable — no weak fallback', async () => {
    const originalCrypto = globalThis.crypto;
    vi.stubGlobal('crypto', { getRandomValues: originalCrypto.getRandomValues.bind(originalCrypto) });
    await expect(signReport(makeMinimalReport())).rejects.toThrow(CryptoUnavailableError);
    vi.stubGlobal('crypto', originalCrypto);
  });

  it('throws CryptoUnavailableError from verifyReport when Web Crypto is unavailable — no weak fallback', async () => {
    const signed = await signReport(makeMinimalReport());
    const originalCrypto = globalThis.crypto;
    vi.stubGlobal('crypto', { getRandomValues: originalCrypto.getRandomValues.bind(originalCrypto) });
    await expect(verifyReport(signed)).rejects.toThrow(CryptoUnavailableError);
    vi.stubGlobal('crypto', originalCrypto);
  });

  it('canonical stability: signing the same logical report twice (different key insertion order) yields the same digest', async () => {
    const reportA = makeMinimalReport();
    const reportB = JSON.parse(JSON.stringify(reportA));
    // Rebuild reportB with reversed top-level key insertion order to prove
    // canonicalization — not JS object insertion order — drives the digest.
    const reversedB = Object.fromEntries(Object.entries(reportB).reverse()) as typeof reportB;
    expect(await digestReport(reportA)).toBe(await digestReport(reversedB));
  });
});

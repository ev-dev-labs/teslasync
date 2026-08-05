import { describe, it, expect, vi, afterEach } from 'vitest';
import { verifyPackEnvelope } from '../verifyEnvelope';
import { CryptoUnavailableError, Ed25519UnsupportedError, _resetEd25519SupportCacheForTests } from '../packCrypto';
import { EFFICIENCY_INSIGHTS_ENVELOPE, COMMUNITY_DRAFT_ENVELOPE, TAMPERED_DEMO_ENVELOPE } from '../catalogFixtures';
import type { SignedPackEnvelope } from '../manifestTypes';

afterEach(() => {
  _resetEd25519SupportCacheForTests();
  vi.restoreAllMocks();
});

describe('verifyPackEnvelope — unsigned', () => {
  it('reports status "unsigned" for a null signature, without touching Ed25519', async () => {
    const result = await verifyPackEnvelope(COMMUNITY_DRAFT_ENVELOPE);
    expect(result.status).toBe('unsigned');
    expect(result.recomputedPublisherFingerprint).toBeNull();
    expect(result.recognizedPublisherName).toBeNull();
  });
});

describe('verifyPackEnvelope — signed & valid', () => {
  it('reports status "signature-valid" for the bundled signed fixture', async () => {
    const result = await verifyPackEnvelope(EFFICIENCY_INSIGHTS_ENVELOPE);
    expect(result.status).toBe('signature-valid');
    expect(result.recomputedPublisherFingerprint).toBe(EFFICIENCY_INSIGHTS_ENVELOPE.manifest.publisher.fingerprint);
    expect(result.claimedFingerprintMismatch).toBe(false);
  });

  it('recognizes the bundled sample publisher fingerprint from the local allowlist', async () => {
    const result = await verifyPackEnvelope(EFFICIENCY_INSIGHTS_ENVELOPE);
    expect(result.recognizedPublisherName).toBe('TeslaSync Labs (Sample Publisher)');
    expect(result.summary).toMatch(/proves key possession/i);
  });

  it('summary explicitly distinguishes "proves key possession" from "publisher trustworthiness"', async () => {
    const result = await verifyPackEnvelope(EFFICIENCY_INSIGHTS_ENVELOPE);
    expect(result.summary.toLowerCase()).toContain('key possession');
  });
});

describe('verifyPackEnvelope — tamper detection', () => {
  it('reports status "signature-invalid" for the deliberately tampered demo envelope', async () => {
    const result = await verifyPackEnvelope(TAMPERED_DEMO_ENVELOPE);
    expect(result.status).toBe('signature-invalid');
    expect(result.summary).toMatch(/do not trust/i);
  });

  it('detects tampering introduced ad hoc (mutate a field after copying a valid envelope)', async () => {
    const clone: SignedPackEnvelope = JSON.parse(JSON.stringify(EFFICIENCY_INSIGHTS_ENVELOPE));
    delete clone.contentDigestSha256Hex; // isolate the Ed25519 signature check itself (digest-mismatch is a separate, also-tested tamper signal)
    clone.manifest.name = 'Renamed Post-Signing (Tampered)';
    const result = await verifyPackEnvelope(clone);
    expect(result.status).toBe('signature-invalid');
  });

  it('reports status "digest-mismatch" when the supplied digest disagrees with the recomputed one', async () => {
    const clone: SignedPackEnvelope = JSON.parse(JSON.stringify(EFFICIENCY_INSIGHTS_ENVELOPE));
    clone.contentDigestSha256Hex = 'a'.repeat(64);
    const result = await verifyPackEnvelope(clone);
    expect(result.status).toBe('digest-mismatch');
  });

  it('flags claimedFingerprintMismatch when publisher.fingerprint disagrees with the actual signing key', async () => {
    // Changing the claimed fingerprint necessarily changes the signed
    // manifest bytes (there is no way to re-sign without the private key),
    // so signature verification itself also fails here -- but
    // `claimedFingerprintMismatch` is computed independently of the
    // signature outcome, from the recomputed key fingerprint vs the claim.
    const clone: SignedPackEnvelope = JSON.parse(JSON.stringify(EFFICIENCY_INSIGHTS_ENVELOPE));
    delete clone.contentDigestSha256Hex;
    clone.manifest.publisher.fingerprint = 'f'.repeat(64);
    const result = await verifyPackEnvelope(clone);
    expect(result.status).toBe('signature-invalid');
    expect(result.claimedFingerprintMismatch).toBe(true);
  });
});

describe('verifyPackEnvelope — crypto unavailable / unsupported must fail explicitly, never silently degrade', () => {
  it('propagates CryptoUnavailableError when crypto.subtle is unavailable for a signed pack', async () => {
    // `subtle` is an accessor on Crypto.prototype (not an own property), so
    // `delete crypto.subtle` is a no-op. Shadow it with an own property
    // instead, and remove that own property afterward to restore the
    // original prototype getter.
    Object.defineProperty(crypto, 'subtle', { value: undefined, configurable: true });
    try {
      await expect(verifyPackEnvelope(EFFICIENCY_INSIGHTS_ENVELOPE)).rejects.toThrow(CryptoUnavailableError);
    } finally {
      delete (crypto as { subtle?: unknown }).subtle;
    }
  });

  it('propagates Ed25519UnsupportedError when Ed25519 import fails', async () => {
    _resetEd25519SupportCacheForTests();
    const importSpy = vi.spyOn(crypto.subtle, 'importKey').mockRejectedValue(new Error('unsupported algorithm'));
    try {
      await expect(verifyPackEnvelope(EFFICIENCY_INSIGHTS_ENVELOPE)).rejects.toThrow(Ed25519UnsupportedError);
    } finally {
      importSpy.mockRestore();
      _resetEd25519SupportCacheForTests();
    }
  });

  it('never returns a "signature-valid"-equivalent result when the platform cannot check at all', async () => {
    Object.defineProperty(crypto, 'subtle', { value: undefined, configurable: true });
    try {
      await expect(verifyPackEnvelope(EFFICIENCY_INSIGHTS_ENVELOPE)).rejects.toBeInstanceOf(CryptoUnavailableError);
    } finally {
      delete (crypto as { subtle?: unknown }).subtle;
    }
  });
});

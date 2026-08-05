import { describe, it, expect } from 'vitest';
import { parseSignedEnvelope } from '../manifestValidator';
import { verifyPackEnvelope } from '../verifyEnvelope';
import { CATALOG_ENTRIES, EFFICIENCY_INSIGHTS_ENVELOPE, COMMUNITY_DRAFT_ENVELOPE, TAMPERED_DEMO_ENVELOPE } from '../catalogFixtures';

describe('catalog fixtures — structural validity', () => {
  it('every bundled catalog entry parses successfully through the real validator', () => {
    for (const entry of CATALOG_ENTRIES) {
      const result = parseSignedEnvelope(JSON.stringify(entry.envelope));
      expect(result.ok, `${entry.envelope.manifest.id} failed to parse`).toBe(true);
    }
  });

  it('has exactly 3 curated entries: signed, unsigned, tampered', () => {
    expect(CATALOG_ENTRIES).toHaveLength(3);
  });
});

describe('catalog fixtures — signed sample verifies genuinely valid', () => {
  it('EFFICIENCY_INSIGHTS_ENVELOPE has a non-null Ed25519 signature block', () => {
    expect(EFFICIENCY_INSIGHTS_ENVELOPE.signature?.algorithm).toBe('Ed25519');
  });

  it('verifies as signature-valid end-to-end', async () => {
    const result = await verifyPackEnvelope(EFFICIENCY_INSIGHTS_ENVELOPE);
    expect(result.status).toBe('signature-valid');
  });
});

describe('catalog fixtures — unsigned community draft', () => {
  it('has a null signature and empty publisher fingerprint', () => {
    expect(COMMUNITY_DRAFT_ENVELOPE.signature).toBeNull();
    expect(COMMUNITY_DRAFT_ENVELOPE.manifest.publisher.fingerprint).toBe('');
  });

  it('verifies as status "unsigned"', async () => {
    const result = await verifyPackEnvelope(COMMUNITY_DRAFT_ENVELOPE);
    expect(result.status).toBe('unsigned');
  });
});

describe('catalog fixtures — tampered demo genuinely fails signature verification', () => {
  it('has the SAME signature bytes as the valid signed pack, but different manifest content', () => {
    expect(TAMPERED_DEMO_ENVELOPE.signature?.signatureBase64).toBe(EFFICIENCY_INSIGHTS_ENVELOPE.signature?.signatureBase64);
    expect(TAMPERED_DEMO_ENVELOPE.manifest.id).not.toBe(EFFICIENCY_INSIGHTS_ENVELOPE.manifest.id);
  });

  it('verifies as status "signature-invalid" through the real verification code path (not a hardcoded UI mock)', async () => {
    const result = await verifyPackEnvelope(TAMPERED_DEMO_ENVELOPE);
    expect(result.status).toBe('signature-invalid');
  });
});

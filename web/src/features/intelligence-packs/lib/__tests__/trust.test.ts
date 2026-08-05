import { describe, it, expect } from 'vitest';
import { formatFingerprint, isRecognizedPublisher, isEnableAllowed, KNOWN_PUBLISHER_FINGERPRINTS, type TrustDecision } from '../trust';
import { EFFICIENCY_INSIGHTS_ENVELOPE } from '../catalogFixtures';

describe('formatFingerprint', () => {
  it('groups hex into uppercase 4-char blocks separated by colons', () => {
    const hex = 'abcd1234'.repeat(8); // 64 chars
    const formatted = formatFingerprint(hex);
    expect(formatted).toBe(formatted.toUpperCase());
    expect(formatted.split(':').every((g) => g.length === 4)).toBe(true);
  });

  it('returns an em dash placeholder for empty input', () => {
    expect(formatFingerprint('')).toBe('\u2014');
  });
});

describe('isRecognizedPublisher', () => {
  it('recognizes the bundled sample catalog fingerprint', () => {
    const known = isRecognizedPublisher(EFFICIENCY_INSIGHTS_ENVELOPE.manifest.publisher.fingerprint);
    expect(known).not.toBeNull();
    expect(known?.name).toBe('TeslaSync Labs (Sample Publisher)');
  });

  it('returns null for an unrecognized fingerprint', () => {
    expect(isRecognizedPublisher('f'.repeat(64))).toBeNull();
  });

  it('returns null for a null fingerprint (unsigned packs)', () => {
    expect(isRecognizedPublisher(null)).toBeNull();
  });

  it('lookup is case-insensitive (normalizes to lowercase)', () => {
    const upper = EFFICIENCY_INSIGHTS_ENVELOPE.manifest.publisher.fingerprint.toUpperCase();
    expect(isRecognizedPublisher(upper)).not.toBeNull();
  });

  it('KNOWN_PUBLISHER_FINGERPRINTS is a small, local, static allowlist (not fetched over the network)', () => {
    expect(Object.keys(KNOWN_PUBLISHER_FINGERPRINTS).length).toBeGreaterThan(0);
    expect(Object.keys(KNOWN_PUBLISHER_FINGERPRINTS).length).toBeLessThan(20);
  });
});

describe('isEnableAllowed', () => {
  it('returns false when there is no trust decision at all', () => {
    expect(isEnableAllowed(null)).toBe(false);
  });

  it('returns false when the decision is "blocked"', () => {
    const decision: TrustDecision = {
      packId: 'x',
      decision: 'blocked',
      publisherFingerprint: null,
      decidedAtIso: 'now',
      approvedCapabilities: [],
    };
    expect(isEnableAllowed(decision)).toBe(false);
  });

  it('returns true for trusted-signed-recognized / trusted-signed-unrecognized / trusted-dev-unsigned', () => {
    const base: Omit<TrustDecision, 'decision'> = {
      packId: 'x',
      publisherFingerprint: null,
      decidedAtIso: 'now',
      approvedCapabilities: [],
    };
    expect(isEnableAllowed({ ...base, decision: 'trusted-signed-recognized' })).toBe(true);
    expect(isEnableAllowed({ ...base, decision: 'trusted-signed-unrecognized' })).toBe(true);
    expect(isEnableAllowed({ ...base, decision: 'trusted-dev-unsigned' })).toBe(true);
  });
});

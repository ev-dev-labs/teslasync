import { describe, it, expect } from 'vitest';
import { parseSemver, compareSemver, isAppVersionCompatible } from '../compatibility';

describe('parseSemver', () => {
  it('parses a well-formed major.minor.patch string', () => {
    expect(parseSemver('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
  });

  it('returns null for non-semver input', () => {
    expect(parseSemver('dev')).toBeNull();
    expect(parseSemver('1.2')).toBeNull();
    expect(parseSemver('1.2.3-beta')).toBeNull();
    expect(parseSemver('')).toBeNull();
  });
});

describe('compareSemver', () => {
  it('orders by major, then minor, then patch', () => {
    expect(compareSemver({ major: 1, minor: 0, patch: 0 }, { major: 2, minor: 0, patch: 0 })).toBe(-1);
    expect(compareSemver({ major: 1, minor: 5, patch: 0 }, { major: 1, minor: 2, patch: 0 })).toBe(1);
    expect(compareSemver({ major: 1, minor: 2, patch: 9 }, { major: 1, minor: 2, patch: 3 })).toBe(1);
    expect(compareSemver({ major: 1, minor: 2, patch: 3 }, { major: 1, minor: 2, patch: 3 })).toBe(0);
  });
});

describe('isAppVersionCompatible', () => {
  const compat = { minAppVersion: '1.0.0', maxAppVersion: '2.0.0' };

  it('is compatible within the [min, max] inclusive range', () => {
    expect(isAppVersionCompatible(compat, '1.0.0').compatible).toBe(true);
    expect(isAppVersionCompatible(compat, '2.0.0').compatible).toBe(true);
    expect(isAppVersionCompatible(compat, '1.5.0').compatible).toBe(true);
  });

  it('is incompatible below minAppVersion', () => {
    const result = isAppVersionCompatible(compat, '0.9.9');
    expect(result.compatible).toBe(false);
    expect(result.reason).toMatch(/>=/);
  });

  it('is incompatible above maxAppVersion', () => {
    const result = isAppVersionCompatible(compat, '2.0.1');
    expect(result.compatible).toBe(false);
    expect(result.reason).toMatch(/<=/);
  });

  it('treats a null maxAppVersion as unbounded above', () => {
    const result = isAppVersionCompatible({ minAppVersion: '1.0.0', maxAppVersion: null }, '99.0.0');
    expect(result.compatible).toBe(true);
  });

  it('treats an unparsable running app version ("dev") as compatibility-skipped, not a hard failure', () => {
    const result = isAppVersionCompatible(compat, 'dev');
    expect(result.compatible).toBe(true);
    expect(result.reason).toMatch(/skipped/i);
  });

  it('rejects a pack declaring an invalid minAppVersion', () => {
    const result = isAppVersionCompatible({ minAppVersion: 'nope', maxAppVersion: null }, '1.0.0');
    expect(result.compatible).toBe(false);
  });

  it('rejects a pack declaring an invalid maxAppVersion', () => {
    const result = isAppVersionCompatible({ minAppVersion: '1.0.0', maxAppVersion: 'nope' }, '1.0.0');
    expect(result.compatible).toBe(false);
  });
});

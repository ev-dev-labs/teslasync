import { afterEach, describe, expect, it } from 'vitest';
import {
  OperationalModeWriteError,
  assertOperationalWriteAllowed,
  deriveOperationalMode,
  isOperationalModeWriteError,
  normalizeAsOf,
} from './operationalMode';

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('operational mode derivation', () => {
  it('uses live mode when online without a historical anchor', () => {
    expect(deriveOperationalMode(null, true)).toEqual({
      mode: 'live',
      asOf: null,
      online: true,
      isReadOnly: false,
    });
  });

  it('uses cached read-only mode when offline', () => {
    expect(deriveOperationalMode(null, false)).toMatchObject({
      mode: 'cached',
      online: false,
      isReadOnly: true,
    });
  });

  it('gives a valid historical anchor precedence over connectivity', () => {
    expect(
      deriveOperationalMode('2026-01-02T03:04:05Z', false),
    ).toMatchObject({
      mode: 'as_of',
      asOf: '2026-01-02T03:04:05.000Z',
      online: false,
      isReadOnly: true,
    });
  });

  it('ignores malformed historical anchors', () => {
    expect(normalizeAsOf('not-a-date')).toBeNull();
    expect(deriveOperationalMode('not-a-date', true).mode).toBe('live');
  });
});

describe('operational write guard', () => {
  it('fails closed before a live-only mutation in historical mode', () => {
    window.history.replaceState(
      null,
      '',
      '/commands?as_of=2026-01-02T03%3A04%3A05Z',
    );

    expect(() =>
      assertOperationalWriteAllowed('POST', true),
    ).toThrow(OperationalModeWriteError);

    try {
      assertOperationalWriteAllowed('POST', true);
    } catch (error) {
      expect(isOperationalModeWriteError(error)).toBe(true);
      expect((error as OperationalModeWriteError).mode).toBe('as_of');
    }
  });

  it('allows reads and mutations that do not require live mode', () => {
    window.history.replaceState(
      null,
      '',
      '/settings?as_of=2026-01-02T03%3A04%3A05Z',
    );

    expect(() => assertOperationalWriteAllowed('GET', true)).not.toThrow();
    expect(() => assertOperationalWriteAllowed('POST', false)).not.toThrow();
  });
});

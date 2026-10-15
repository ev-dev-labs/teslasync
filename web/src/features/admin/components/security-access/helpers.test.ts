import { describe, it, expect } from 'vitest';
import {
  doorClosed,
  parseWindowState,
  isSentryActive,
  allWindowsClosed,
  securityPosture,
  windowSummary,
  findLastLockChange,
  buildSentryBuckets,
  computeSecurityStats,
  deriveTimeline,
} from './helpers';
import type { SecurityEvent } from '@/types/admin';

// ---------------------------------------------------------------------------
// security-access/helpers hardening
//
// The backend serializes raw
// `signal.SignalValue` directly. Fields like `doorState`, `sentryMode`,
// `*Window` may arrive as native booleans (e.g. `false`) or string enums
// like `"SentryModeStateOff"`, "ClosedAll" depending on the protomodel
// emission. These tests pin the contract that helpers never crash on a
// non-string and never silently mis-classify a boolean as the wrong state.
// ---------------------------------------------------------------------------

describe('doorClosed (Phase-42a typed values)', () => {
  it.each([null, undefined, '', {}, { DriverFront: null }, 'Unknown', '{broken'])('keeps absent or unrecognized %p unknown', (v) => {
    expect(doorClosed(v)).toBeNull();
  });

  it.each(['closed', 'ClosedAll', '0', 'false'])('treats %p as closed', (v) => {
    expect(doorClosed(v)).toBe(true);
  });

  it('boolean false → closed', () => {
    expect(doorClosed(false)).toBe(true);
  });

  it('boolean true → open', () => {
    expect(doorClosed(true)).toBe(false);
  });

  it('number 0 → closed; non-zero → open', () => {
    expect(doorClosed(0)).toBe(true);
    expect(doorClosed(1)).toBe(false);
  });

  it('string "OpenDriverFront" → open', () => {
    expect(doorClosed('OpenDriverFront')).toBe(false);
  });

  it('JSON object string with all false → closed', () => {
    expect(doorClosed('{"DriverFront":false,"PassengerFront":false}')).toBe(true);
  });

  it('JSON object string with one true → open', () => {
    expect(doorClosed('{"DriverFront":true,"PassengerFront":false}')).toBe(false);
  });

  it('native object payload with all false → closed', () => {
    expect(doorClosed({ DriverFront: false, PassengerFront: false })).toBe(true);
  });

  it('native object payload with one true → open', () => {
    expect(doorClosed({ DriverFront: true, PassengerFront: false })).toBe(false);
  });
});

describe('parseWindowState (Phase-42a typed values)', () => {
  it.each([null, undefined, '', false, true, 0, 1, {}, []])('non-string %p → "Unknown"', (v) => {
    expect(parseWindowState(v)).toBe('Unknown');
  });

  it('"Closed" / "0" → "Closed"', () => {
    expect(parseWindowState('Closed')).toBe('Closed');
    expect(parseWindowState('0')).toBe('Closed');
  });

  it('vent-class strings → "Venting"', () => {
    expect(parseWindowState('Vented')).toBe('Venting');
    expect(parseWindowState('PartialVent')).toBe('Venting');
  });

  it('open-class strings → "Open"', () => {
    expect(parseWindowState('Open')).toBe('Open');
    expect(parseWindowState('FullyOpen')).toBe('Open');
  });

  it('does NOT coerce booleans to "true"/"false" then mis-classify', () => {
    // String("false") would match `lower !== '0'` → "Open" — this would be wrong.
    // The hardened guard returns "Unknown" for non-strings instead.
    expect(parseWindowState(false)).toBe('Unknown');
    expect(parseWindowState(true)).toBe('Unknown');
  });
});

describe('isSentryActive (Phase-42a typed values)', () => {
  it('boolean true → active', () => {
    expect(isSentryActive(true)).toBe(true);
  });

  it('boolean false → inactive', () => {
    expect(isSentryActive(false)).toBe(false);
  });

  it.each([null, undefined, '', 0, NaN, {}, 'Unknown', 'future-enum'])('missing/unrecognized %p stays unknown', (v) => {
    expect(isSentryActive(v)).toBeNull();
  });

  function event(id: string, createdAt: string, values: Partial<SecurityEvent> = {}): SecurityEvent {
    return {
      id, createdAt, locked: null, sentryMode: null, doorState: null,
      fdWindow: null, fpWindow: null, rdWindow: null, rpWindow: null,
      homelinkNearby: null, guestMode: null, homelinkDeviceCount: null,
      guestModeMobileAccessState: null, driverSeatOccupied: null, centerDisplay: null,
      speedLimitMode: null, valetModeEnabled: null, serviceMode: null, pairedPhoneKeyCount: null,
      lightsHazardsActive: null, lightsHighBeams: null, lightsTurnSignal: null,
      driverSeatBelt: null, passengerSeatBelt: null, ...values,
    };
  }

  describe('security evidence preservation', () => {
    const closed = { locked: true, doorState: false, fdWindow: 'Closed', fpWindow: 'Closed', rdWindow: 'Closed', rpWindow: 'Closed' };

    it('does not claim secure or open windows when readings are missing', () => {
      expect(securityPosture(undefined)).toBeNull();
      const unknown = event('unknown', '2026-10-11T01:00:00Z');
      expect(securityPosture(unknown)).toBeNull();
      expect(allWindowsClosed(unknown)).toBeNull();
      expect(windowSummary(unknown, (_key, fallback) => fallback)).toBe('Unknown');
      expect(parseWindowState('future-enum')).toBe('Unknown');
      expect(securityPosture(event('secure', unknown.createdAt, closed))).toBe(true);
      expect(securityPosture(event('partial', unknown.createdAt, { ...closed, doorState: null }))).toBeNull();
      expect(securityPosture(event('unlocked', unknown.createdAt, { locked: false }))).toBe(false);
    });

    it('selects the latest transition without mutating ascending or descending raw rows', () => {
      const rows = [
        event('a', '2026-10-11T10:00:00Z', { locked: false }),
        event('b', '2026-10-11T11:00:00Z', { locked: true }),
        event('c', '2026-10-11T12:00:00Z', { locked: false }),
      ];
      expect(findLastLockChange(rows)).toBe(rows[2].createdAt);
      expect(findLastLockChange([...rows].reverse())).toBe(rows[2].createdAt);
      expect(rows.map((row) => row.id)).toEqual(['a', 'b', 'c']);
      expect(findLastLockChange([rows[0]])).toBe(rows[0].createdAt);
      expect(findLastLockChange([])).toBeUndefined();
      expect(findLastLockChange([rows[0], event('unknown', rows[1].createdAt), rows[2]])).toBe(rows[0].createdAt);
      expect(findLastLockChange([event('invalid', 'invalid')])).toBeUndefined();
    });

    it('keeps unknown Sentry samples distinct and groups the actual workspace calendar day', () => {
      const rows = [
        event('a', '2026-10-11T01:00:00Z', { sentryMode: true }),
        event('b', '2026-10-11T02:00:00Z', { sentryMode: false }),
        event('c', '2026-10-11T03:00:00Z'),
      ];
      expect(buildSentryBuckets(rows, 'America/Los_Angeles')).toEqual([
        { date: '2026-10-10', sentryOn: 1, sentryOff: 1, sentryUnknown: 1 },
      ]);
      expect(buildSentryBuckets(rows, 'UTC')[0].date).toBe('2026-10-11');
      expect(buildSentryBuckets([
        event('before', '2026-03-08T07:59:59Z', { sentryMode: false }),
        event('after', '2026-03-08T08:00:00Z', { sentryMode: true }),
      ], 'America/Los_Angeles').map((bucket) => bucket.date)).toEqual(['2026-03-07', '2026-03-08']);
    });

    it('does not create transitions or open counts from missing signals', () => {
      const rows = [event('a', '2026-10-11T10:00:00Z'), event('b', '2026-10-11T11:00:00Z', closed)];
      expect(deriveTimeline(rows)).toEqual([]);
      expect(computeSecurityStats(rows)).toMatchObject({ lockEvents: 0, doorOpenCount: 0, windowOpenCount: 0, total: 2 });
    });
  });

  it.each(['SentryModeStateArmed', 'Armed', 'On'])('non-Off enum %p → active', (v) => {
    expect(isSentryActive(v)).toBe(true);
  });

  it.each(['SentryModeStateOff', 'Off'])('Off enum %p → inactive', (v) => {
    expect(isSentryActive(v)).toBe(false);
  });
});

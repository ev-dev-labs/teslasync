import { describe, it, expect } from 'vitest';
import {
  doorClosed,
  parseWindowState,
  isSentryActive,
} from './helpers';

// ---------------------------------------------------------------------------
// security-access/helpers — Phase-42a hardening
//
// After the per-field MQTT cutover the backend serializes raw
// `signal.SignalValue` directly. Fields like `doorState`, `sentryMode`,
// `*Window` may arrive as native booleans (e.g. `false`) or string enums
// like `"SentryModeStateOff"`, "ClosedAll" depending on the protomodel
// emission. These tests pin the contract that helpers never crash on a
// non-string and never silently mis-classify a boolean as the wrong state.
// ---------------------------------------------------------------------------

describe('doorClosed (Phase-42a typed values)', () => {
  it.each([null, undefined])('treats nullish as closed (no signal data → safe default)', (v) => {
    expect(doorClosed(v)).toBe(true);
  });

  it.each(['', 'closed', 'ClosedAll', '0', 'false'])('treats %p as closed', (v) => {
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

  it.each([null, undefined, '', 0, NaN, {}])('nullish/non-string %p → inactive', (v) => {
    expect(isSentryActive(v)).toBe(false);
  });

  it.each(['SentryModeStateArmed', 'Armed', 'On'])('non-Off enum %p → active', (v) => {
    expect(isSentryActive(v)).toBe(true);
  });

  it.each(['SentryModeStateOff', 'Off'])('Off enum %p → inactive', (v) => {
    expect(isSentryActive(v)).toBe(false);
  });
});

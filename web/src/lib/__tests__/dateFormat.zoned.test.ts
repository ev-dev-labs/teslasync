import { describe, it, expect } from 'vitest';
import { zonedWallTimeToUtc, toZonedDatetimeStr } from '../dateFormat';

const LA = 'America/Los_Angeles';

describe('zonedWallTimeToUtc', () => {
  it('interprets datetime-local text in the given zone', () => {
    // Noon in LA (PDT) is 19:00 UTC.
    expect(zonedWallTimeToUtc('2026-07-01T12:00', LA)?.toISOString()).toBe('2026-07-01T19:00:00.000Z');
    // Noon in LA (PST) is 20:00 UTC.
    expect(zonedWallTimeToUtc('2026-01-01T12:00', LA)?.toISOString()).toBe('2026-01-01T20:00:00.000Z');
    expect(zonedWallTimeToUtc('2026-07-01T12:00:00', 'UTC')?.toISOString()).toBe('2026-07-01T12:00:00.000Z');
  });

  it('resolves a spring-forward gap to the later offset', () => {
    // 02:30 never occurs on 2026-03-08 in LA; compatible behavior shifts forward.
    const resolved = zonedWallTimeToUtc('2026-03-08T02:30', LA);
    expect(resolved?.toISOString()).toBe('2026-03-08T10:30:00.000Z');
  });

  it('resolves a fall-back overlap to the first occurrence', () => {
    // 01:30 occurs twice on 2026-11-01 in LA; the first is PDT (UTC-7).
    const resolved = zonedWallTimeToUtc('2026-11-01T01:30', LA);
    expect(resolved?.toISOString()).toBe('2026-11-01T08:30:00.000Z');
  });

  it('round-trips through toZonedDatetimeStr', () => {
    const instant = new Date('2026-07-01T19:00:00.000Z');
    expect(toZonedDatetimeStr(instant, LA)).toBe('2026-07-01T12:00');
    expect(zonedWallTimeToUtc(toZonedDatetimeStr(instant, LA), LA)?.toISOString())
      .toBe('2026-07-01T19:00:00.000Z');
  });

  it('returns null for unparseable text', () => {
    expect(zonedWallTimeToUtc(null, LA)).toBeNull();
    expect(zonedWallTimeToUtc('', LA)).toBeNull();
    expect(zonedWallTimeToUtc('tomorrow at noon', LA)).toBeNull();
    expect(zonedWallTimeToUtc('2026-02-30T12:00', LA)).toBeNull();
    expect(zonedWallTimeToUtc('2026-07-01T25:00', LA)).toBeNull();
  });

  it('falls back to browser-local interpretation for unknown zones', () => {
    expect(zonedWallTimeToUtc('2026-07-01T12:00', 'Mars/Olympus_Mons')?.getTime())
      .toBe(new Date('2026-07-01T12:00').getTime());
  });
});

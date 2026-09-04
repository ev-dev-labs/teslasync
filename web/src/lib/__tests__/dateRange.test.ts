import { describe, it, expect } from 'vitest';
import {
  calendarRangeToInstants,
  localMidnightToInstant,
} from '../dateRange';

describe('localMidnightToInstant', () => {
  it('resolves PST midnight to UTC instant 7h ahead (standard time)', () => {
    // 2026-01-15 is winter — PST is UTC-08
    const t = localMidnightToInstant('2026-01-15', 'America/Los_Angeles');
    expect(t.toISOString()).toBe('2026-01-15T08:00:00.000Z');
  });

  it('resolves PDT midnight to UTC instant 7h ahead (daylight time)', () => {
    // 2026-05-12 is summer — PDT is UTC-07
    const t = localMidnightToInstant('2026-05-12', 'America/Los_Angeles');
    expect(t.toISOString()).toBe('2026-05-12T07:00:00.000Z');
  });

  it('resolves UTC midnight as itself', () => {
    const t = localMidnightToInstant('2026-05-12', 'UTC');
    expect(t.toISOString()).toBe('2026-05-12T00:00:00.000Z');
  });

  it('resolves Asia/Kolkata (UTC+5:30, no DST)', () => {
    const t = localMidnightToInstant('2026-05-12', 'Asia/Kolkata');
    // 2026-05-12 00:00 IST = 2026-05-11 18:30 UTC
    expect(t.toISOString()).toBe('2026-05-11T18:30:00.000Z');
  });

  it('handles spring-forward day correctly (no off-by-1)', () => {
    // 2026-03-08 is the US DST start day — local clocks jump 02:00 → 03:00
    // Local midnight on the spring-forward day is still 08:00 UTC (PST).
    const t = localMidnightToInstant('2026-03-08', 'America/Los_Angeles');
    expect(t.toISOString()).toBe('2026-03-08T08:00:00.000Z');
  });

  it('handles fall-back day correctly', () => {
    // 2026-11-01 is the US DST end day — local clocks fall 02:00 → 01:00
    // Local midnight on the fall-back day is still 07:00 UTC (PDT, before
    // the 02:00 transition).
    const t = localMidnightToInstant('2026-11-01', 'America/Los_Angeles');
    expect(t.toISOString()).toBe('2026-11-01T07:00:00.000Z');
  });

  it('throws on malformed date input', () => {
    expect(() => localMidnightToInstant('not-a-date', 'UTC')).toThrow();
  });

  it('uses the first valid instant when a timezone skips local midnight', () => {
    expect(
      localMidnightToInstant('2025-09-07', 'America/Santiago').toISOString(),
    ).toBe('2025-09-07T04:00:00.000Z');
  });
});

describe('calendarRangeToInstants', () => {
  it('produces a half-open window for a single PDT day', () => {
    // Picking just 2026-05-12 in PDT should span 07:00Z → next-day 07:00Z.
    const r = calendarRangeToInstants({
      startDate: '2026-05-12',
      endDate: '2026-05-12',
      timezone: 'America/Los_Angeles',
    });
    expect(r.startInstant).toBe('2026-05-12T07:00:00.000Z');
    expect(r.endInstantExclusive).toBe('2026-05-13T07:00:00.000Z');
  });

  it('produces a half-open window for a multi-day PDT range', () => {
    // The exact symptom that motivated the fix: "Last 7 days · May 6–12"
    // in PDT must include 2026-05-13T02:54Z (a 19:54 PST today drive).
    const r = calendarRangeToInstants({
      startDate: '2026-05-06',
      endDate: '2026-05-12',
      timezone: 'America/Los_Angeles',
    });
    expect(r.startInstant).toBe('2026-05-06T07:00:00.000Z');
    expect(r.endInstantExclusive).toBe('2026-05-13T07:00:00.000Z');
    const sample = new Date('2026-05-13T02:54:12Z').getTime();
    expect(sample).toBeGreaterThanOrEqual(new Date(r.startInstant).getTime());
    expect(sample).toBeLessThan(new Date(r.endInstantExclusive).getTime());
  });

  it('crosses month boundary cleanly', () => {
    const r = calendarRangeToInstants({
      startDate: '2026-05-31',
      endDate: '2026-05-31',
      timezone: 'America/Los_Angeles',
    });
    expect(r.startInstant).toBe('2026-05-31T07:00:00.000Z');
    expect(r.endInstantExclusive).toBe('2026-06-01T07:00:00.000Z');
  });

  it('UTC timezone yields plain UTC midnights', () => {
    const r = calendarRangeToInstants({
      startDate: '2026-05-12',
      endDate: '2026-05-12',
      timezone: 'UTC',
    });
    expect(r.startInstant).toBe('2026-05-12T00:00:00.000Z');
    expect(r.endInstantExclusive).toBe('2026-05-13T00:00:00.000Z');
  });
});

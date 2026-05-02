import { describe, it, expect } from 'vitest';
import { formatDateTime, formatDate, formatTime, formatDateShort, tzAbbreviation } from '../dateFormat';

const ISO = '2026-04-04T14:30:00Z'; // 2026-04-04 14:30 UTC

describe('dateFormat — tz override', () => {
  it('formatDateTime renders the same instant in different zones', () => {
    const ny = formatDateTime(ISO, { tz: 'America/New_York', locale: 'en-US' });
    const tokyo = formatDateTime(ISO, { tz: 'Asia/Tokyo', locale: 'en-US' });
    expect(ny).not.toBe(tokyo);
    // 14:30 UTC = 10:30 EDT (Apr 4) and 23:30 JST (Apr 4)
    expect(ny).toContain('10:30');
    expect(tokyo).toContain('11:30');
    expect(tokyo).toContain('PM');
  });

  it('formatDate respects the tz override at the day boundary', () => {
    // 23:30 UTC → next day in Tokyo, same day in LA.
    const lateUtc = '2026-04-04T23:30:00Z';
    const tokyo = formatDate(lateUtc, { tz: 'Asia/Tokyo', locale: 'en-US' });
    const la = formatDate(lateUtc, { tz: 'America/Los_Angeles', locale: 'en-US' });
    expect(tokyo).toContain('Apr 5');
    expect(la).toContain('Apr 4');
  });

  it('formatTime applies the tz override', () => {
    const utc = formatTime(ISO, { tz: 'UTC', locale: 'en-US' });
    const ny = formatTime(ISO, { tz: 'America/New_York', locale: 'en-US' });
    expect(utc).toContain('02:30');
    expect(ny).toContain('10:30');
  });

  it('formatDateShort applies the tz override', () => {
    const lateUtc = '2026-04-04T23:30:00Z';
    expect(formatDateShort(lateUtc, { tz: 'Asia/Tokyo', locale: 'en-US' })).toContain('Apr 5');
    expect(formatDateShort(lateUtc, { tz: 'America/Los_Angeles', locale: 'en-US' })).toContain('Apr 4');
  });

  it('formatDateTime with no opts preserves prior pure behavior', () => {
    // No throw, returns a non-empty string for a valid ISO.
    const out = formatDateTime(ISO);
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
    expect(out).not.toBe('—');
  });

  it('formatDateTime returns "—" for nullish/invalid inputs regardless of opts', () => {
    expect(formatDateTime(null, { tz: 'UTC' })).toBe('—');
    expect(formatDateTime(undefined, { tz: 'UTC' })).toBe('—');
    expect(formatDateTime('not-a-date', { tz: 'UTC' })).toBe('—');
  });
});

describe('tzAbbreviation', () => {
  it('returns DST-aware abbreviations for Los Angeles', () => {
    // January = PST, July = PDT.
    const jan = new Date('2026-01-15T18:00:00Z');
    const jul = new Date('2026-07-15T18:00:00Z');
    expect(tzAbbreviation(jan, 'America/Los_Angeles')).toBe('PST');
    expect(tzAbbreviation(jul, 'America/Los_Angeles')).toBe('PDT');
  });

  it('returns "" for invalid dates', () => {
    expect(tzAbbreviation('not-a-date', 'UTC')).toBe('');
  });

  it('returns "" for invalid tz without throwing', () => {
    expect(tzAbbreviation(new Date(), 'Not/A_Zone')).toBe('');
  });

  it('accepts ISO strings as input', () => {
    expect(tzAbbreviation('2026-01-15T18:00:00Z', 'UTC')).toMatch(/UTC|GMT/);
  });
});

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  formatDateTime, formatDate, formatTime, formatDateShort, tzAbbreviation,
  formatRelativeDays, formatRelativeDayKey, formatDayKey, ymdInTz,
} from '../dateFormat';

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

describe('formatRelativeDays', () => {
  // Pin "now" to a known local-midnight so day deltas are deterministic
  // regardless of the test runner's actual clock or timezone. We use a
  // local-time constructor (new Date(y, m, d, h, m, s)) so the date
  // boundary matches what the implementation uses (setHours(0,0,0,0)).
  afterEach(() => {
    vi.useRealTimers();
  });

  function freezeNow(year: number, month1: number, day: number, hour = 12) {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(year, month1 - 1, day, hour, 0, 0, 0));
  }

  function localIso(year: number, month1: number, day: number, hour = 12, minute = 0) {
    return new Date(year, month1 - 1, day, hour, minute, 0, 0).toISOString();
  }

  it('returns "—" for nullish or invalid input', () => {
    expect(formatRelativeDays(null)).toBe('—');
    expect(formatRelativeDays(undefined)).toBe('—');
    expect(formatRelativeDays('not-a-date')).toBe('—');
    expect(formatRelativeDays('')).toBe('—');
  });

  it('returns "Today" for the same local day', () => {
    freezeNow(2026, 5, 12, 15);
    expect(formatRelativeDays(localIso(2026, 5, 12, 9))).toBe('Today');
    expect(formatRelativeDays(localIso(2026, 5, 12, 23, 30))).toBe('Today');
  });

  it('returns "Yesterday" for the previous local day', () => {
    freezeNow(2026, 5, 12, 8);
    expect(formatRelativeDays(localIso(2026, 5, 11, 23))).toBe('Yesterday');
    expect(formatRelativeDays(localIso(2026, 5, 11, 0, 1))).toBe('Yesterday');
  });

  it('uses "Xd ago" between 2 and 6 days', () => {
    freezeNow(2026, 5, 12);
    expect(formatRelativeDays(localIso(2026, 5, 10))).toBe('2d ago');
    expect(formatRelativeDays(localIso(2026, 5, 6))).toBe('6d ago');
  });

  it('uses "Xw ago" between 7 and 29 days', () => {
    freezeNow(2026, 5, 12);
    expect(formatRelativeDays(localIso(2026, 5, 5))).toBe('1w ago');
    expect(formatRelativeDays(localIso(2026, 4, 13))).toBe('4w ago');
  });

  it('uses "Xmo ago" between 30 and 364 days', () => {
    freezeNow(2026, 5, 12);
    // 30 days back lands in early Apr — "1mo ago".
    expect(formatRelativeDays(localIso(2026, 4, 12))).toBe('1mo ago');
    // 90 days back — "3mo ago".
    expect(formatRelativeDays(localIso(2026, 2, 11))).toBe('3mo ago');
  });

  it('uses "Xy ago" past 365 days', () => {
    freezeNow(2026, 5, 12);
    expect(formatRelativeDays(localIso(2025, 5, 12))).toBe('1y ago');
    expect(formatRelativeDays(localIso(2020, 5, 12))).toBe('6y ago');
  });

  it('handles future dates with "in Xd"', () => {
    freezeNow(2026, 5, 12);
    expect(formatRelativeDays(localIso(2026, 5, 14))).toBe('in 2d');
  });

  it('never falls back to an absolute date label', () => {
    // The whole reason this helper exists is so group headers don't
    // render "Apr 24, 2026 · Apr 24, 2026". Sample a wide range of ages
    // and assert none of them look like an absolute date.
    freezeNow(2026, 5, 12);
    const samples = [
      localIso(2026, 5, 12),
      localIso(2026, 5, 1),
      localIso(2026, 4, 1),
      localIso(2025, 5, 12),
      localIso(2010, 1, 1),
    ];
    for (const iso of samples) {
      expect(formatRelativeDays(iso)).not.toMatch(/\d{4}/);
    }
  });

  it('uses the supplied tz when computing day deltas', () => {
    // 2026-05-12 00:30 UTC = 2026-05-11 17:30 in LA. With tz=LA the
    // helper should report "Yesterday" relative to a 2026-05-12 LA date,
    // proving day-keys are computed in the requested zone (not browser).
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-12T15:00:00-07:00'));
    expect(
      formatRelativeDays('2026-05-12T00:30:00Z', { tz: 'America/Los_Angeles' }),
    ).toBe('Yesterday');
    vi.useRealTimers();
  });
});

describe('formatRelativeDayKey', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the current Pacific calendar day as Today after UTC midnight', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-28T02:23:00Z'));

    expect(
      formatRelativeDayKey('2026-08-27', { tz: 'America/Los_Angeles' }),
    ).toBe('Today');
    expect(formatRelativeDayKey('2026-08-27', { tz: 'UTC' })).toBe('Yesterday');
  });

  it('returns the fallback for malformed day keys', () => {
    expect(formatRelativeDayKey('not-a-day', { tz: 'UTC' })).toBe('—');
  });
});

describe('ymdInTz', () => {
  it('returns YYYY-MM-DD in the requested zone', () => {
    expect(ymdInTz(new Date('2026-04-25T02:30:00Z'), 'America/Los_Angeles')).toBe('2026-04-24');
    expect(ymdInTz(new Date('2026-04-25T02:30:00Z'), 'Asia/Tokyo')).toBe('2026-04-25');
    expect(ymdInTz(new Date('2026-04-25T02:30:00Z'), 'UTC')).toBe('2026-04-25');
  });

  it('falls back to browser-local when tz is omitted', () => {
    const result = ymdInTz(new Date('2026-04-25T02:30:00Z'));
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('returns null for invalid Date', () => {
    expect(ymdInTz(new Date('not-a-date'))).toBeNull();
  });
});

describe('formatDayKey', () => {
  it('renders short style without the year', () => {
    expect(formatDayKey('2026-04-24', { style: 'short', locale: 'en-US' })).toBe('Apr 24');
  });

  it('renders long style with the year', () => {
    expect(formatDayKey('2026-04-24', { style: 'long', locale: 'en-US' })).toBe('Apr 24, 2026');
  });

  it('defaults to long style', () => {
    expect(formatDayKey('2026-04-24', { locale: 'en-US' })).toBe('Apr 24, 2026');
  });

  it('returns the fallback string for malformed keys', () => {
    expect(formatDayKey('not-a-key')).toBe('—');
    expect(formatDayKey('2026-04')).toBe('—');
  });

  it('does not shift days when the browser is in a different tz', () => {
    // Direct YMD parsing — same key always produces the same label.
    // This is the whole reason formatDayKey exists vs round-tripping
    // through Date in some tz that might cross midnight.
    expect(formatDayKey('2026-04-24', { style: 'long', locale: 'en-US' })).toBe('Apr 24, 2026');
  });
});

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  formatDateTime, formatDate, formatTime, formatDateShort, tzAbbreviation,
  formatRelativeDays, formatRelativeDayKey, formatDayKey, formatMonthYear, formatMonthName,
  formatWeekdayName, formatChartInstant, formatMonthDayHour, formatHourName, ymdInTz,
  isoUtcToLocalDatetimeInput, localDatetimeInputToIso,
  formatDurationMs, formatDurationMsCompact, formatDurationMsLong,
  formatDurationSecondsAsMinutes, formatDurationMinutes, formatDurationRange,
  formatDurationClock,
} from '../dateFormat';
import {
  fmtNumber, fmtWithUnit, getGlobalLocale, getGlobalPrecision,
  isFiniteNumber, setGlobalLocale, setGlobalPrecision,
} from '../numberFormat';

const ISO = '2026-04-04T14:30:00Z'; // 2026-04-04 14:30 UTC

describe('elapsed duration validity', () => {
  const formatters = [
    formatDurationMs, formatDurationMsCompact, formatDurationMsLong,
    formatDurationSecondsAsMinutes, formatDurationMinutes, formatDurationClock,
  ];
  const originalLocale = getGlobalLocale();
  const originalPrecision = getGlobalPrecision();

  afterEach(() => {
    setGlobalLocale(originalLocale);
    setGlobalPrecision(originalPrecision);
  });

  it.each([null, undefined])('keeps missing duration %s unknown', (value) => {
    for (const format of formatters) expect(format(value)).toBe('—');
  });

  it.each([NaN, Infinity, -Infinity, -1, -0.25, -60_000])(
    'rejects invalid elapsed duration %s before rounding',
    (value) => {
      for (const format of formatters) expect(format(value)).toBe('—');
    },
  );

  it('renders measured zero rather than a missing-value placeholder', () => {
    setGlobalLocale('en-US');
    setGlobalPrecision(2);
    expect(formatDurationMs(0)).toBe('0.00ms');
    expect(formatDurationMsCompact(0)).toBe('0.00ms');
    expect(formatDurationSecondsAsMinutes(0)).toBe('0m');
    expect(formatDurationMinutes(0)).toBe('0m');
    expect(formatDurationClock(0)).toBe('0:00');
  });

  it('treats a zero long duration as "no run yet" rather than measured', () => {
    setGlobalLocale('en-US');
    setGlobalPrecision(2);
    expect(formatDurationMsLong(0)).toBe('—');
  });

  it('preserves fractional measurements and existing unit transitions', () => {
    setGlobalLocale('en-US');
    setGlobalPrecision(2);
    for (const format of [formatDurationMs, formatDurationMsCompact, formatDurationMsLong]) {
      expect(format(0.25)).toBe('0.25ms');
      expect(format(1000)).toBe('1.00s');
      expect(format(1250)).toBe('1.25s');
    }
    expect(formatDurationMs(60_000)).toBe('60.00s');
    expect(formatDurationMsCompact(60_000)).toBe('1.00m');
    expect(formatDurationMsLong(65_000)).toBe('1m 5s');
    expect(formatDurationSecondsAsMinutes(90)).toBe('2m');
    expect(formatDurationMinutes(1.5)).toBe('2m');
    expect(formatDurationClock(1250)).toBe('0:01');
  });

  it('distinguishes missing, invalid, reversed, equal and fractional timestamp ranges', () => {
    expect(formatDurationRange(null, ISO)).toBe('—');
    expect(formatDurationRange(ISO, undefined)).toBe('—');
    expect(formatDurationRange('not-a-date', ISO)).toBe('—');
    expect(formatDurationRange(ISO, new Date(NaN))).toBe('—');
    expect(formatDurationRange(ISO, '2026-04-04T14:29:59.999Z')).toBe('—');
    expect(formatDurationRange(ISO, ISO)).toBe('0m');
    expect(formatDurationRange(ISO, '2026-04-04T14:30:00.250Z')).toBe('0m');
    expect(formatDurationRange(ISO, '2026-04-04T14:31:30Z')).toBe('2m');
  });

  it('leaves zero, signed and fractional physical/net number formatting intact', () => {
    setGlobalLocale('en-US');
    setGlobalPrecision(2);
    expect(isFiniteNumber(-0.25)).toBe(true);
    expect(fmtNumber(0)).toBe('0.00');
    expect(fmtNumber(-1.25)).toBe('-1.25');
    expect(fmtNumber(1.25)).toBe('1.25');
    expect(fmtWithUnit(-1.25, 'W')).toBe('-1.25 W');
    expect(fmtWithUnit(-0.25, '°C')).toBe('-0.25 °C');
  });

  it.each(['de-DE', 'ar-EG'])('uses the effective numeric locale %s for utilization durations', (locale) => {
    setGlobalLocale(locale);
    setGlobalPrecision(3);
    const integer = new Intl.NumberFormat(locale, {
      minimumFractionDigits: 0, maximumFractionDigits: 0,
    });
    expect(formatDurationSecondsAsMinutes(0)).toBe(`${integer.format(0)}m`);
    expect(formatDurationSecondsAsMinutes(0.25)).toBe(`${integer.format(0)}m`);
    expect(formatDurationSecondsAsMinutes(89.5)).toBe(`${integer.format(1)}m`);
    expect(formatDurationSecondsAsMinutes(90)).toBe(`${integer.format(2)}m`);
    expect(formatDurationSecondsAsMinutes(3600)).toBe(`${integer.format(1)}h`);
    expect(formatDurationSecondsAsMinutes(3629.5)).toBe(`${integer.format(1)}h`);
    expect(formatDurationSecondsAsMinutes(3630)).toBe(`${integer.format(1)}h ${integer.format(1)}m`);
    expect(formatDurationSecondsAsMinutes(1234 * 3600 + 90))
      .toBe(`${integer.format(1234)}h ${integer.format(2)}m`);
    for (const value of [null, undefined, NaN, Infinity, -Infinity, -0.25, -90]) {
      expect(formatDurationSecondsAsMinutes(value)).toBe('—');
    }
    expect(fmtNumber(-1.25)).toBe(new Intl.NumberFormat(locale, {
      minimumFractionDigits: 3, maximumFractionDigits: 3,
    }).format(-1.25));
  });

  it('uses numeric locale fallback without changing rounded-minute precision', () => {
    setGlobalLocale('invalid_locale');
    setGlobalPrecision(3);
    expect(formatDurationSecondsAsMinutes(90)).toBe('2m');
    expect(formatDurationSecondsAsMinutes(1234 * 3600 + 90)).toBe('1,234h 2m');
  });
});

describe('dateFormat — tz override', () => {
  it('localizes publication days without converting them into zoned instants', () => {
    for (const tz of ['America/Los_Angeles', 'Pacific/Kiritimati']) {
      expect(formatDayKey('2026-07-02', { tz, locale: 'en-US' })).toBe('Jul 2, 2026');
      expect(formatDayKey('2026-07-02', { tz, locale: 'de-DE' })).toBe('2. Juli 2026');
    }
    expect(formatDate('2026-07-02T00:00:00Z', { tz: 'America/Los_Angeles', locale: 'en-US' }))
      .toBe('Jul 1, 2026');
  });

  it('renders a 2-digit year when yearStyle requests it', () => {
    expect(formatDate('2026-07-02T00:00:00Z', { tz: 'America/Los_Angeles', locale: 'en-US', yearStyle: '2-digit' }))
      .toBe('Jul 1, 26');
  });

  it.each([null, undefined, '', '2026-00-01', '2026-13-01', '2026-04-31', '2026-02-29', '2026-07-02T00:00:00Z'])(
    'rejects missing or invalid publication day %s rather than normalizing it',
    (value) => {
      expect(formatDayKey(value, { locale: 'en-US' })).toBe('—');
    },
  );

  it('preserves valid leap days and years below 100', () => {
    expect(formatDayKey('2024-02-29', { locale: 'en-US' })).toBe('Feb 29, 2024');
    expect(formatDayKey('0099-07-02', { locale: 'en-US' })).toBe('Jul 2, 99');
  });

  it('preserves explicit seconds and clock conventions without changing default precision', () => {
    const instant = '2026-04-05T02:30:47Z';
    const opts = { tz: 'America/Los_Angeles', locale: 'en-US' };
    expect(formatDateTime(instant, { ...opts, clock: { second: '2-digit', hour12: false } }))
      .toBe('Apr 4, 2026, 19:30:47');
    expect(formatDateTime(instant, { ...opts, clock: { second: '2-digit', hour12: true } }))
      .toBe('Apr 4, 2026, 07:30:47 PM');
    expect(formatDateTime(instant, opts)).toBe('Apr 4, 2026, 07:30 PM');
    expect(formatTime(instant, opts)).toBe('07:30 PM');
    expect(formatTime(instant, { ...opts, clock: { second: '2-digit', hour12: false } })).toBe('19:30:47');
    expect(formatTime(instant, opts)).toBe('07:30 PM');
    expect(formatDate(instant, { ...opts, clock: { second: '2-digit' } })).toBe('Apr 4, 2026');
    expect(formatDayKey('2026-04-05', { ...opts, clock: { second: '2-digit' } })).toBe('Apr 5, 2026');
  });

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

describe('formatMonthYear', () => {
  it('renders calendar months zone-stable', () => {
    expect(formatMonthYear('2027-03-15', { locale: 'en-US', tz: 'America/Los_Angeles' })).toBe('Mar 2027');
    expect(formatMonthYear('2027-03-15', { locale: 'en-US', tz: 'Asia/Tokyo' })).toBe('Mar 2027');
    expect(formatMonthYear('2027-03', { locale: 'en-US' })).toBe('Mar 2027');
  });

  it('renders instants in the target zone', () => {
    // Nov 1 06:00Z is still Oct 31 in LA but Nov 1 in Tokyo.
    expect(formatMonthYear('2026-11-01T06:00:00.000Z', { locale: 'en-US', tz: 'America/Los_Angeles' })).toBe('Oct 2026');
    expect(formatMonthYear('2026-11-01T06:00:00.000Z', { locale: 'en-US', tz: 'Asia/Tokyo' })).toBe('Nov 2026');
  });

  it('returns the placeholder for missing or invalid input', () => {
    expect(formatMonthYear(null, { locale: 'en-US' })).toBe('—');
    expect(formatMonthYear(undefined, { locale: 'en-US' })).toBe('—');
    expect(formatMonthYear('', { locale: 'en-US' })).toBe('—');
    expect(formatMonthYear('not-a-date', { locale: 'en-US' })).toBe('—');
    expect(formatMonthYear('2027-13', { locale: 'en-US' })).toBe('—');
    expect(formatMonthYear('2027-00', { locale: 'en-US' })).toBe('—');
    // Impossible days never roll over into a neighboring month.
    expect(formatMonthYear('2026-02-30', { locale: 'en-US' })).toBe('—');
    expect(formatMonthYear('2026-04-31', { locale: 'en-US' })).toBe('—');
    expect(formatMonthYear('2026-03-00', { locale: 'en-US' })).toBe('—');
  });

  it('falls back to en-US for an invalid locale tag', () => {
    expect(formatMonthYear('2027-03-15', { locale: 'not-a-locale' })).toBe('Mar 2027');
  });

  it('renders a 2-digit year when requested', () => {
    expect(formatMonthYear('2027-03', { locale: 'en-US', yearStyle: '2-digit' })).toBe('Mar 27');
    expect(formatMonthYear('2027-03-15', { locale: 'en-US', tz: 'Asia/Tokyo', yearStyle: '2-digit' })).toBe('Mar 27');
    expect(formatMonthYear('2026-11-01T06:00:00.000Z', { locale: 'en-US', tz: 'America/Los_Angeles', yearStyle: '2-digit' })).toBe('Oct 26');
  });
});

describe('calendar values never shift; instants convert', () => {
  // Date-only and month-only values are calendar values, not instants:
  // they render as-is in every zone, including the extreme UTC+14 offset,
  // even when a zone is explicitly supplied. Real timestamps convert to
  // the user's zone instead.
  it.each([
    ['America/Los_Angeles'],
    ['Pacific/Kiritimati'],
  ])('renders calendar values as-is in %s', (tz) => {
    expect(formatMonthYear('2026-03', { locale: 'en-US', tz })).toBe('Mar 2026');
    expect(formatDayKey('2026-03-01', { locale: 'en-US', tz })).toBe('Mar 1, 2026');
    expect(formatMonthName('2026-03', { locale: 'en-US', tz })).toBe('Mar');
  });

  it('converts an instant near midnight UTC into the user zone', () => {
    // 00:30Z Mar 1 is still Feb 28 in LA but Mar 1 in Kiritimati.
    expect(formatDateTime('2026-03-01T00:30:00.000Z', { locale: 'en-US', tz: 'America/Los_Angeles' }))
      .toBe('Feb 28, 2026, 04:30 PM');
    expect(formatDateTime('2026-03-01T00:30:00.000Z', { locale: 'en-US', tz: 'Pacific/Kiritimati' }))
      .toBe('Mar 1, 2026, 02:30 PM');
  });
});

describe('formatMonthName', () => {
  it('renders calendar months and month numbers zone-stable', () => {
    expect(formatMonthName('2027-03', { locale: 'en-US', tz: 'America/Los_Angeles' })).toBe('Mar');
    expect(formatMonthName('2027-03', { locale: 'en-US', tz: 'Asia/Tokyo' })).toBe('Mar');
    expect(formatMonthName(3, { locale: 'en-US' })).toBe('Mar');
    expect(formatMonthName(12, { locale: 'en-US' })).toBe('Dec');
  });

  it('renders instants in the target zone', () => {
    // Nov 1 06:00Z is still Oct 31 in LA but Nov 1 in Tokyo.
    expect(formatMonthName('2026-11-01T06:00:00.000Z', { locale: 'en-US', tz: 'America/Los_Angeles' })).toBe('Oct');
    expect(formatMonthName('2026-11-01T06:00:00.000Z', { locale: 'en-US', tz: 'Asia/Tokyo' })).toBe('Nov');
    expect(formatMonthName(new Date('2026-11-01T06:00:00.000Z'), { locale: 'en-US', tz: 'Asia/Tokyo' })).toBe('Nov');
  });

  it('returns the placeholder for missing or invalid input', () => {
    expect(formatMonthName(null, { locale: 'en-US' })).toBe('—');
    expect(formatMonthName(undefined, { locale: 'en-US' })).toBe('—');
    expect(formatMonthName('', { locale: 'en-US' })).toBe('—');
    expect(formatMonthName('not-a-date', { locale: 'en-US' })).toBe('—');
    expect(formatMonthName('2027-13', { locale: 'en-US' })).toBe('—');
    expect(formatMonthName(0, { locale: 'en-US' })).toBe('—');
    expect(formatMonthName(13, { locale: 'en-US' })).toBe('—');
    expect(formatMonthName(2.5, { locale: 'en-US' })).toBe('—');
  });

  it('falls back to en-US for an invalid locale tag', () => {
    expect(formatMonthName('2027-03', { locale: 'not-a-locale' })).toBe('Mar');
  });
});

describe('formatWeekdayName', () => {
  it('renders the weekday in the target zone', () => {
    // 2026-01-04 is a Sunday; noon UTC keeps the name stable everywhere.
    expect(formatWeekdayName(new Date(Date.UTC(2026, 0, 4, 12)), { locale: 'en-US', tz: 'UTC' })).toBe('Sun');
    expect(formatWeekdayName(new Date(Date.UTC(2026, 0, 5, 12)), { locale: 'en-US', tz: 'UTC' })).toBe('Mon');
    // Near midnight the zone decides the day: 00:30Z Sunday is Saturday in LA.
    expect(formatWeekdayName('2026-01-04T00:30:00.000Z', { locale: 'en-US', tz: 'UTC' })).toBe('Sun');
    expect(formatWeekdayName('2026-01-04T00:30:00.000Z', { locale: 'en-US', tz: 'America/Los_Angeles' })).toBe('Sat');
  });

  it('returns the placeholder for missing or invalid input', () => {
    expect(formatWeekdayName(null, { locale: 'en-US' })).toBe('—');
    expect(formatWeekdayName(undefined, { locale: 'en-US' })).toBe('—');
    expect(formatWeekdayName('', { locale: 'en-US' })).toBe('—');
    expect(formatWeekdayName('not-a-date', { locale: 'en-US' })).toBe('—');
  });

  it('falls back to en-US for an invalid locale tag', () => {
    expect(formatWeekdayName(new Date(Date.UTC(2026, 0, 4, 12)), { locale: 'not-a-locale', tz: 'UTC' })).toBe('Sun');
  });

  it('renders the long name with weekdayStyle long', () => {
    expect(formatWeekdayName(new Date(Date.UTC(2026, 0, 5, 12)), { locale: 'en-US', tz: 'UTC', weekdayStyle: 'long' })).toBe('Monday');
    expect(formatWeekdayName('2026-01-04T00:30:00.000Z', { locale: 'en-US', tz: 'America/Los_Angeles', weekdayStyle: 'long' })).toBe('Saturday');
  });
});

describe('formatHourName', () => {
  it('renders hour buckets zone-stable', () => {
    expect(formatHourName(0, { locale: 'en-US', tz: 'America/Los_Angeles' })).toBe('12 AM');
    expect(formatHourName(0, { locale: 'en-US', tz: 'Pacific/Kiritimati' })).toBe('12 AM');
    expect(formatHourName(15, { locale: 'en-US' })).toBe('3 PM');
    expect(formatHourName(23, { locale: 'en-US' })).toBe('11 PM');
  });

  it('returns the placeholder for missing or invalid input', () => {
    expect(formatHourName(null, { locale: 'en-US' })).toBe('—');
    expect(formatHourName(undefined, { locale: 'en-US' })).toBe('—');
    expect(formatHourName(-1, { locale: 'en-US' })).toBe('—');
    expect(formatHourName(24, { locale: 'en-US' })).toBe('—');
    expect(formatHourName(2.5, { locale: 'en-US' })).toBe('—');
    expect(formatHourName(NaN, { locale: 'en-US' })).toBe('—');
  });

  it('falls back to en-US for an invalid locale tag', () => {
    expect(formatHourName(9, { locale: 'not-a-locale' })).toBe('9 AM');
  });

  it('appends :00 minutes with showMinutes', () => {
    expect(formatHourName(2, { locale: 'en-US', showMinutes: true })).toBe('2:00 AM');
    expect(formatHourName(14, { locale: 'en-US', showMinutes: true })).toBe('2:00 PM');
    expect(formatHourName(0, { locale: 'en-US', tz: 'Pacific/Kiritimati', showMinutes: true })).toBe('12:00 AM');
  });
});

describe('formatMonthDayHour', () => {
  it('renders instants in the target zone, accepting epoch millis', () => {
    // Oct 1 00:30Z is still Sep 30 in LA but Oct 1 in Tokyo.
    expect(formatMonthDayHour(Date.parse('2026-10-01T00:30:00.000Z'), { locale: 'en-US', tz: 'America/Los_Angeles' })).toBe('Sep 30, 05 PM');
    expect(formatMonthDayHour(Date.parse('2026-10-01T00:30:00.000Z'), { locale: 'en-US', tz: 'Asia/Tokyo' })).toBe('Oct 1, 09 AM');
    expect(formatMonthDayHour('2026-10-01T00:30:00.000Z', { locale: 'en-US', tz: 'Asia/Tokyo' })).toBe('Oct 1, 09 AM');
    expect(formatMonthDayHour(new Date('2026-10-01T00:30:00.000Z'), { locale: 'en-US', tz: 'Asia/Tokyo' })).toBe('Oct 1, 09 AM');
  });

  it('returns the placeholder for missing or invalid input', () => {
    expect(formatMonthDayHour(null, { locale: 'en-US' })).toBe('—');
    expect(formatMonthDayHour(undefined, { locale: 'en-US' })).toBe('—');
    expect(formatMonthDayHour('', { locale: 'en-US' })).toBe('—');
    expect(formatMonthDayHour('not-a-date', { locale: 'en-US' })).toBe('—');
    expect(formatMonthDayHour(NaN, { locale: 'en-US' })).toBe('—');
  });

  it('falls back to en-US for an invalid locale tag', () => {
    expect(formatMonthDayHour(Date.parse('2026-10-01T00:30:00.000Z'), { locale: 'not-a-locale', tz: 'Asia/Tokyo' })).toBe('Oct 1, 09 AM');
  });
});

describe('formatChartInstant', () => {
  it('distinguishes repeated fall-back hours by UTC offset', () => {
    const first = formatChartInstant(Date.parse('2026-11-01T08:00:00.000Z'), { locale: 'en-US', tz: 'America/Los_Angeles' });
    const repeated = formatChartInstant(Date.parse('2026-11-01T09:00:00.000Z'), { locale: 'en-US', tz: 'America/Los_Angeles' });
    expect(first).toContain('GMT-7');
    expect(repeated).toContain('GMT-8');
    expect(first).not.toBe(repeated);
  });

  it('returns the placeholder for missing or invalid input', () => {
    expect(formatChartInstant(null, { locale: 'en-US' })).toBe('—');
    expect(formatChartInstant(undefined, { locale: 'en-US' })).toBe('—');
    expect(formatChartInstant('', { locale: 'en-US' })).toBe('—');
    expect(formatChartInstant('not-a-date', { locale: 'en-US' })).toBe('—');
    expect(formatChartInstant(NaN, { locale: 'en-US' })).toBe('—');
  });

  it('falls back to en-US for an invalid locale tag', () => {
    expect(formatChartInstant(Date.parse('2026-11-01T08:00:00.000Z'), { locale: 'not-a-locale', tz: 'America/Los_Angeles' })).toContain('GMT-7');
  });
});

describe('isoUtcToLocalDatetimeInput', () => {
  it('emits a minute-precision datetime-local value', () => {
    expect(isoUtcToLocalDatetimeInput(ISO)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  it('round-trips without shifting the instant in any timezone', () => {
    // The input parses the value as LOCAL wall time; parsing it back must
    // recover the original instant (TZ-independent: true in every zone).
    const input = isoUtcToLocalDatetimeInput(ISO);
    expect(new Date(input).getTime()).toBe(new Date(ISO).getTime());
  });

  it('differs from a naive UTC slice whenever off-UTC', () => {
    // Naive slicing is the bug this helper replaces: it only coincides with
    // the correct local value when the runner is exactly UTC.
    const naive = ISO.slice(0, 16);
    const correct = isoUtcToLocalDatetimeInput(ISO);
    const offsetMin = new Date(ISO).getTimezoneOffset();
    if (offsetMin === 0) {
      expect(correct).toBe(naive);
    } else {
      expect(correct).not.toBe(naive);
    }
  });

  it("returns '' for missing or invalid input", () => {
    expect(isoUtcToLocalDatetimeInput(null)).toBe('');
    expect(isoUtcToLocalDatetimeInput(undefined)).toBe('');
    expect(isoUtcToLocalDatetimeInput('')).toBe('');
    expect(isoUtcToLocalDatetimeInput('not-a-date')).toBe('');
  });
});

describe('localDatetimeInputToIso', () => {
  it('parses local wall time back to the UTC instant', () => {
    const input = isoUtcToLocalDatetimeInput(ISO);
    expect(localDatetimeInputToIso(input)).toBe(new Date(ISO).toISOString());
  });

  it('returns null for empty or invalid input instead of throwing', () => {
    expect(localDatetimeInputToIso(null)).toBeNull();
    expect(localDatetimeInputToIso(undefined)).toBeNull();
    expect(localDatetimeInputToIso('')).toBeNull();
    expect(localDatetimeInputToIso('not-a-date')).toBeNull();
  });
});

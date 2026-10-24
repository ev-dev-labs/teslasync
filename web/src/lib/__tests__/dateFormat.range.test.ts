import { describe, it, expect } from 'vitest';
import {formatDateRange, formatDayKeyRange, formatTime, formatDateTime} from '../dateFormat'
import {ymdInTz} from '../dateConvert';

const LA = 'America/Los_Angeles';
const TOKYO = 'Asia/Tokyo';
const EN = 'en-US';

describe('formatDateRange (end-inclusive display)', () => {
  it('shows the inclusive last day for a half-open query range', () => {
    // The charging evidence drawer query: [Sep 22 00:00, Oct 22 00:00) LA.
    const label = formatDateRange('2026-09-22T07:00:00.000Z', '2026-10-22T07:00:00.000Z', { tz: LA, locale: EN });
    expect(label).toContain('Sep 22');
    expect(label).toContain('Oct 21');
    expect(label).not.toContain('Oct 22');
    expect(label).toBe('Sep 22 – Oct 21, 2026');
  });

  it('collapses a single-day range to one date', () => {
    expect(formatDateRange('2026-10-21T07:00:00.000Z', '2026-10-22T07:00:00.000Z', { tz: LA, locale: EN }))
      .toBe('Oct 21, 2026');
  });

  it('assigns midnight-adjacent instants to the selected zone, not UTC', () => {
    // 2026-10-21T23:30+09:00 Tokyo is still Oct 21 in LA (07:30) — the range
    // end just past Tokyo midnight must show Oct 21, not Oct 22.
    expect(ymdInTz(new Date('2026-10-21T14:30:00.000Z'), TOKYO)).toBe('2026-10-21');
    expect(ymdInTz(new Date('2026-10-21T14:30:00.000Z'), LA)).toBe('2026-10-21');
    expect(formatDateRange('2026-10-21T15:00:00.000Z', '2026-10-22T15:00:00.000Z', { tz: TOKYO, locale: EN }))
      .toBe('Oct 22, 2026');
  });

  it('renders a reversed range without throwing', () => {
    // Swapped to [Oct 21, Oct 22): the single day between the two instants.
    expect(formatDateRange('2026-10-22T07:00:00.000Z', '2026-10-21T07:00:00.000Z', { tz: LA, locale: EN }))
      .toBe('Oct 21, 2026');
  });

  it('returns the placeholder for missing or invalid bounds', () => {
    expect(formatDateRange(null, '2026-10-22T07:00:00.000Z', { tz: LA })).toBe('—');
    expect(formatDateRange('2026-10-21T07:00:00.000Z', undefined, { tz: LA })).toBe('—');
    expect(formatDateRange('not-a-date', '2026-10-22T07:00:00.000Z', { tz: LA })).toBe('—');
    expect(formatDateRange('2026-10-21T07:00:00.000Z', 'not-a-date', { tz: LA })).toBe('—');
  });

  it('accepts Date bounds', () => {
    expect(formatDateRange(new Date('2026-09-22T07:00:00.000Z'), new Date('2026-10-22T07:00:00.000Z'), { tz: LA, locale: EN }))
      .toBe('Sep 22 – Oct 21, 2026');
  });
});

describe('formatDayKeyRange (inclusive calendar span)', () => {
  it('renders both calendar days with one collapsed year', () => {
    expect(formatDayKeyRange('2026-08-01', '2026-08-08', { locale: EN })).toBe('Aug 1 – 8, 2026');
  });

  it('collapses a single-day span to one date', () => {
    expect(formatDayKeyRange('2026-08-08', '2026-08-08', { locale: EN })).toBe('Aug 8, 2026');
  });

  it('never shifts with the display zone', () => {
    expect(formatDayKeyRange('2026-08-01', '2026-08-08', { locale: EN, tz: TOKYO }))
      .toBe(formatDayKeyRange('2026-08-01', '2026-08-08', { locale: EN, tz: LA }));
  });

  it('renders a reversed span without throwing', () => {
    expect(formatDayKeyRange('2026-08-08', '2026-08-01', { locale: EN })).toBe('Aug 1 – 8, 2026');
  });

  it('returns the placeholder for missing or invalid keys', () => {
    expect(formatDayKeyRange(null, '2026-08-08')).toBe('—');
    expect(formatDayKeyRange('2026-08-01', undefined)).toBe('—');
    expect(formatDayKeyRange('2026-13-01', '2026-08-08')).toBe('—');
    expect(formatDayKeyRange('2026-08-01', 'tomorrow')).toBe('—');
  });
});

describe('DST transitions', () => {
  it('honors the spring-forward gap in America/Los_Angeles', () => {
    // 2026-03-08 02:00 PST jumps to 03:00 PDT.
    expect(formatTime('2026-03-08T09:30:00.000Z', { tz: LA, locale: EN })).toBe('01:30 AM');
    expect(formatTime('2026-03-08T10:30:00.000Z', { tz: LA, locale: EN })).toBe('03:30 AM');
  });

  it('keeps the repeated fall-back hour on the same civil day', () => {
    // 2026-11-01 02:00 PDT falls back to 01:00 PST; both 01:30s are Nov 1.
    expect(formatTime('2026-11-01T08:30:00.000Z', { tz: LA, locale: EN })).toBe('01:30 AM');
    expect(formatTime('2026-11-01T09:30:00.000Z', { tz: LA, locale: EN })).toBe('01:30 AM');
    expect(ymdInTz(new Date('2026-11-01T08:30:00.000Z'), LA)).toBe('2026-11-01');
    expect(ymdInTz(new Date('2026-11-01T09:30:00.000Z'), LA)).toBe('2026-11-01');
  });
});

describe('invalid timezone sanitization', () => {
  it('falls back to the browser zone instead of throwing', () => {
    const iso = '2026-04-04T14:30:00.000Z';
    expect(formatDateTime(iso, { tz: 'Mars/Olympus_Mons', locale: EN }))
      .toBe(formatDateTime(iso, { locale: EN }));
    expect(formatTime(iso, { tz: '', locale: EN })).toBe(formatTime(iso, { locale: EN }));
    expect(formatDateRange(iso, '2026-04-05T14:30:00.000Z', { tz: 'Bogus/Zone', locale: EN }))
      .toBe(formatDateRange(iso, '2026-04-05T14:30:00.000Z', { locale: EN }));
  });
});

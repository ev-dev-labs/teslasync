import { describe, it, expect } from 'vitest';
import {
  getBucketingMode,
  rangeDays,
  DEFAULT_BUCKETING_THRESHOLDS,
} from '../bucketing';

describe('bucketing.getBucketingMode', () => {
  it.each([
    [1,    'day'],
    [7,    'day'],
    [14,   'day'],
    [15,   'week'],
    [30,   'week'],
    [90,   'week'],
    [91,   'month'],
    [365,  'month'],
    [730,  'month'],
    [731,  'year'],
    [3650, 'year'],
  ])('maps %d days → %s', (days, mode) => {
    expect(getBucketingMode(days)).toBe(mode);
  });

  it('falls back to day for invalid input', () => {
    expect(getBucketingMode(NaN)).toBe('day');
    expect(getBucketingMode(-5)).toBe('day');
    expect(getBucketingMode(0)).toBe('day');
  });

  it('respects custom thresholds', () => {
    const custom = { dayUpTo: 7, weekUpTo: 30, monthUpTo: 365 };
    expect(getBucketingMode(7, custom)).toBe('day');
    expect(getBucketingMode(8, custom)).toBe('week');
    expect(getBucketingMode(31, custom)).toBe('month');
    expect(getBucketingMode(366, custom)).toBe('year');
  });
});

describe('bucketing.rangeDays', () => {
  it('counts inclusive days between YMD strings', () => {
    expect(rangeDays('2026-01-01', '2026-01-01')).toBe(1);
    expect(rangeDays('2026-01-01', '2026-01-31')).toBe(31);
    expect(rangeDays('2026-01-01', '2026-02-01')).toBe(32);
  });

  it('handles a full year correctly', () => {
    expect(rangeDays('2026-01-01', '2026-12-31')).toBe(365);
    // Leap year
    expect(rangeDays('2024-01-01', '2024-12-31')).toBe(366);
  });

  it('returns 0 for malformed input', () => {
    expect(rangeDays('not-a-date', '2026-01-01')).toBe(0);
    expect(rangeDays('2026-01-01', 'nope')).toBe(0);
    expect(rangeDays('', '')).toBe(0);
  });

  it('returns 0 when end is before start (operator error guard)', () => {
    expect(rangeDays('2026-02-01', '2026-01-01')).toBe(0);
  });

  it('is timezone-stable (treats inputs as UTC days)', () => {
    // Ranges that span day boundaries in DST shouldn't change length.
    expect(rangeDays('2026-03-01', '2026-04-01')).toBe(32);
    expect(rangeDays('2026-10-01', '2026-11-01')).toBe(32);
  });
});

describe('bucketing.DEFAULT_BUCKETING_THRESHOLDS', () => {
  it('is monotonically increasing', () => {
    expect(DEFAULT_BUCKETING_THRESHOLDS.dayUpTo).toBeLessThan(DEFAULT_BUCKETING_THRESHOLDS.weekUpTo);
    expect(DEFAULT_BUCKETING_THRESHOLDS.weekUpTo).toBeLessThan(DEFAULT_BUCKETING_THRESHOLDS.monthUpTo);
  });
});
